'use strict';

const Client = require('ssh2').Client;
const fs = require('fs');
// list if currently configured devices
const devices = {};
// settings object or false when settings are incomplete.
let settings = false;
// list of currently found devices
let clients = {};
// ssh client poller
let clientPoller = {};

/*
 * This method will be run when the app starts.
 */
module.exports.init = (devicesData, callback) => {
	getSettings();
	devicesData.forEach(initDevice);
	Homey.manager('settings').on('set', settingsSaved);
	// initialize clients and start the clients poller.
	if (Object.keys(devices).length > 0 && settings) {
		getClients();
		setClientPoller();
	}
	callback();
};

/*
 * This method will be run when a device are added.
 */
module.exports.added = (deviceData, callback) => {
	initDevice(deviceData);
	// if this is the first device, start the poller.
	if (Object.keys(devices).length === 1 && settings) {
		setClientPoller();
	}
	callback(null, true);
};

/*
 * This method will be run when a device is removed.
 */
module.exports.deleted = (deviceData) => {
	_debug('Deleting device:', deviceData.id);
	clearInterval(devices[deviceData.id].pollInterval);
	clearInterval(clientPoller);
	delete devices[deviceData.id];
	if (Object.keys(devices).length === 0) {
		_debug('No more devices left, removing client poller.');
		clearInterval(clientPoller);
	}
};

/*
 * This method will be run when starting to pair.
 */
module.exports.pair = (socket) => {
	socket.on('list_devices', (data, callback) => {
		if (settings) {
			getJson().then(json => {
				const result = parseJson(json);
				const listDevices = getListDevices(result);
				callback(null, listDevices);
			});
		} else {
			callback('Connection settings are not correct, please check settings page!', null);
		}
	});
	socket.on('disconnect', () => {
		_debug('User aborted pairing, or pairing is finished');
	});
};

/*
 * This defines our apps capabilities.
 */
Homey.manifest.drivers[0].capabilities.forEach(capability => {
	module.exports.capabilities = {};
	module.exports.capabilities[capability] = {};
	module.exports.capabilities[capability].get = (deviceData, callback) => {
		const device = getDeviceByData(deviceData);
		if (device instanceof Error) return callback(device);
		return callback(null, device.state[capability]);
	};
});


/*
*  Initialize existing devices and start Interval.
*/
function initDevice(deviceData) {
	_debug('Initialize device:', deviceData.id);
	devices[deviceData.id] = {};
	devices[deviceData.id].data = deviceData;
	devices[deviceData.id].state = {
		client_connected: null,
		measure_signal: null,
		measure_rssi: null,
	};

	devices[deviceData.id].pollInterval = setInterval(() => {
		updateDevice(deviceData);
	}, (10 * 1000));

	for (const cap in devices[deviceData.id].state) {
		if (Object.prototype.hasOwnProperty.call(devices[deviceData.id].state, cap)) {
			module.exports.realtime(deviceData, cap, devices[deviceData.id].state[cap]);
		}
	}
}

/*
 * update our device and related tasks
 */
function updateDevice(deviceData) {
	triggerDeviceFlow(deviceData);
	updateDeviceRealtime(deviceData);
	updateDeviceState(deviceData);
}

/*
 * Trigger device flow when clients connects or
 * disconnects but ignore when just initalized (null)
 */
function triggerDeviceFlow(deviceData) {
	const device = getDeviceByData(deviceData);
	const client = getClientByData(deviceData);
	// client was disconnected but came online
	if (client && device.state.client_connected === false) {
		_debug(`Device ${deviceData.id} is connected.`);
		const tokens = formatMetadata(deviceData);
		Homey.manager('flow').triggerDevice('client_connected', tokens, null, deviceData,
			(err) => {
				if (err) return Homey.error(err);
			}
        );
	}
	// client was connected but went offline.
	if (!client && device.state.client_connected === true) {
		_debug(`Device ${deviceData.id} is disconnected.`);
		Homey.manager('flow').triggerDevice('client_disconnected', null, null, deviceData,
			(err) => {
				if (err) return Homey.error(err);
			}
		);
	}
}

/*
 * Notify homey off device updates
 */
function updateDeviceRealtime(deviceData) {
	const client = getClientByData(deviceData);
	const device = getDeviceByData(deviceData);
	const connected = (client) ? true : false;
	const meta = formatMetadata(deviceData);
	if (device.state.client_connected !== connected) {
		_debug(`Updating: ${deviceData.id} client_connected to: ${connected}`);
		module.exports.realtime(deviceData, 'client_connected', connected);
	}
	if (device.state.measure_signal !== meta.measure_signal) {
		_debug(`Updating: ${deviceData.id} measure_signal to: ${meta.measure_signal}`);
		module.exports.realtime(deviceData, 'measure_signal', meta.measure_signal);
	}
	if (device.state.measure_rssi !== meta.measure_rssi) {
		_debug(`Updating: ${deviceData.id} measure_rssi to: ${meta.measure_rssi}`);
		module.exports.realtime(deviceData, 'measure_rssi', meta.measure_rssi);
	}
}

/*
 * Update our internal device state object
 */
function updateDeviceState(deviceData) {
	const client = getClientByData(deviceData);
	if (client) {
		const meta = formatMetadata(deviceData);
		devices[deviceData.id].state = {
			client_connected: true,
			measure_signal: meta.measure_signal,
			measure_rssi: meta.measure_rssi,
		};
	} else {
		devices[deviceData.id].state = {
			client_connected: false,
			measure_signal: null,
			measure_rssi: null,
		};
	}
}

/*
 * Gracefully borrowed from com.ubnt.unifi
 * This converts our signal and rssi to usefull values
 */
function formatMetadata(deviceData) {
	const client = getClientByData(deviceData);
	let result = { measure_signal: null, measure_rssi: null };
	if (client) {
		result = {
			measure_signal: parseInt((Math.min(45, Math.max(parseFloat(client.rssi), 5)) - 5) / 40 * 99),
			measure_rssi: parseInt(parseFloat(client.rssi) - 95),
		};
	}
	return result;
}

/*
 * Get device by device data
 */
function getDeviceByData(deviceData) {
	const device = devices[deviceData.id];
	if (typeof device === 'undefined') {
		return new Error('invalid_device');
	}
	return device;
}

/*
 * Get client by devicedata.
 */
function getClientByData(deviceData) {
	const client = clients[deviceData.id];
	return (typeof client === 'undefined') ? false : client;
}

/*
 * Check if integer difference is higher then diff.
 */
function compareInt(a, b, diff) {
	if (parseInt(a) && parseInt(b)) {
		if (Math.abs(a - b) > diff) {
			return true;
		}
	} else {
		return true;
	}
}

/*
 * Create a new or update an exiting client poller
 */
function setClientPoller() {
	_debug('Setting a new client poller');
	clearInterval(clientPoller);
	clientPoller = setInterval(() => {
		getClients();
	}, (settings.polltime * 60 * 1000));
}

/*
 * Check if settings have been updated
 * if updated we set our client poller
 */
function settingsSaved(name) {
	_debug('Settings updated by user');
	getSettings();
	if (Object.keys(devices).length > 0 && settings) {
		setClientPoller();
	}
}

/*
 * Get our settings from homey and check if they are set
 */
function getSettings() {
	let error = false;
	const conn = Homey.manager('settings').get('connection');
	for (const key in conn) {
		if (!conn[key] || conn[key].length === 0) {
			_debug(`Setting ${key} is not set.`);
			error = true;
		}
	}
	settings = (error) ? false : conn;
}

/*
 * Create a promise and execute an remote ssh command
 */
function getJson() {
	return new Promise((resolve, reject) => {
		const conn = new Client();
		let json = '';
		_debug('Gettting clients...');
		conn.on('ready', () => {
			conn.exec('mca-dump', (err, stream) => {
				if (err) throw err;
				stream.on('close', () => {
					conn.end();
					resolve(json);
				});
				stream.on('data', (jsonData) => {
					json += jsonData.toString();
				});
				stream.stderr.on('data', (error) => {
					reject(Error(error));
				});
			});
		});
		conn.connect({
			host: settings.hostname,
			username: settings.username,
			password: settings.password,
		});
		conn.on('error', (error) => {
			reject(Error(error));
		});
	});
}

/*
 * Run the ssh promise and wait for the json data
 */
function getClients() {
	getJson().then((json) => {
		const data = parseJson(json);
		clients = formatClients(data);
		_debug(`Found ${Object.keys(clients).length} Clients.`);
		triggerFlows();
	});
}

/*
 * Get all clients from ubiquiti json and put them
 * in a mac addressed keyed object
 */
function formatClients(data) {
	const result = {};
	data.vap_table.forEach((vap) => {
		vap.sta_table.forEach((sta) => {
			if (sta.authorized) {
				result[sta.mac] = sta;
			}
		});
	});
	return result;
}

/*
 * Parse the ubiquiti generated json and return it
 */
function parseJson(json) {
	let data = {};
	try {
		data = JSON.parse(json);
	} catch (e) {
		console.error(e);
	}
	return data;
}

/*
 * Get a list of devices from Ubiquiti json data
 * which is needed for pairing
 */
function getListDevices(data) {
	const result = [];
	data.vap_table.forEach((vap) => {
		vap.sta_table.forEach((sta) => {
			if (sta.authorized) {
				result.push({
					name: (sta.hasOwnProperty('hostname')) ? sta.hostname : sta.mac,
					data: { id: sta.mac },
					meta: { rssi: sta.rssi },
				});
			}
		});
	});
	return result;
}

/*
 * Get the amount of current online devices
 */
function getOnlineDevices() {
	let num = 0;
	Object.keys(devices).forEach(key => {
		if (devices[key].state.client_connected) {
			num++;
		}
	});
	return num;
}

/*
 * Get the amount of online clients which are paired devices
 */
function getOnlineClients() {
	let num = 0;
	Object.keys(clients).forEach(key => {
		if (devices.hasOwnProperty(key)) {
			num++;
		}
	});
	return num;
}

function devicesInitialized() {
	let status = true;
	Object.keys(devices).forEach(key => {
		if (devices[key].state.client_connected === null) {
			status = false;
		}
	});
	return status;
}

function triggerFlows() {
	if (devicesInitialized()) {
		_debug('Triggering flows...');
		// check if first device comes online
		if ((getOnlineDevices() === 0) && (getOnlineClients() > 0)) {
			_debug('First client connected.');
			Homey.manager('flow').trigger('first_online', null, null, (err, result) => {
				if( err ) return Homey.error(err);
			});
		}
		if ((getOnlineDevices > 0) && (getOnlineClients() === 0)) {
			_debug('Last client disconnected.');
			Homey.manager('flow').trigger('last_offline', null, null, (err, result) => {
				if( err ) return Homey.error(err);
			});
		}
		if (getOnlineClients() > getOnlineDevices()) {
			_debug('A client connected.');
			Homey.manager('flow').trigger('client_online', null, null, (err, result) => {
				if( err ) return Homey.error(err);
			});
		}
		if (getOnlineDevices() > getOnlineClients()) {
			_debug('A client disconnected.');
			Homey.manager('flow').trigger('client_offline', null, null, (err, result) => {
				if( err ) return Homey.error(err);
			});
		}
	}
}

function _debug() {
	if (fs.existsSync('/debug')) {
		const args = Array.prototype.slice.call(arguments);
		args.unshift('[debug]:');
		console.log.apply(null, args);
	}
}