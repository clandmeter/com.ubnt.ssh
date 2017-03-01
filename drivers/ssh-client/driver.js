'use strict';

const Client = require('ssh2').Client;
// list if currently configured devices
const devices = {};
// Signal difference to trigger device update
const signalDiff = 2;
// available connection settings
const connSettings = ['hostname', 'username', 'password', 'polltimer'];
// list of currently found devices
let clients = {};
// ssh poll timer in minutes
let clientPoller = {};

// this method will be run when the app starts.
module.exports.init = (devicesData, callback) => {
	devicesData.forEach(initDevice);
	Homey.manager('settings').on('set', settingsSaved);
	if (Object.keys(devices).length > 0 && checkSettings(connSettings)) {
		getClients();
	}
	setClientPoller();
	callback();
};

// this method will be run when a device are added.
module.exports.added = (deviceData, callback) => {
	initDevice(deviceData);
	callback(null, true);
};

// this method will be run when a drive is removed.
module.exports.deleted = (deviceData) => {
	console.log('Deleting device:', deviceData.id);
	clearInterval(devices[deviceData.id].pollInterval);
	delete devices[deviceData.id];
};

// this method will be run when starting to pair.
module.exports.pair = (socket) => {
	let json = '';
	socket.on('list_devices', (data, callback) => {
		if (checkSettings(connSettings)) {
			const conn = new Client();
			conn.on('ready', () => {
				conn.exec('mca-dump', (err, stream) => {
					if (err) console.error(err);
					stream.on('close', () => {
						conn.end();
						let obj = formatClients(json);
						let deviceData = Object.keys(obj).map((key) => { return obj[key]; });
						callback(null, deviceData);
					}).on('data', (jsonData) => {
						json += jsonData.toString();
					}).stderr.on('data', (error) => {
						Homey.log(`STDERR: ${error}`);
					});
				});
			});
			conn.connect({
				host: Homey.manager('settings').get('hostname'),
				username: Homey.manager('settings').get('username'),
				password: Homey.manager('settings').get('password'),
			});
			conn.on('error', (error) => {
				console.error('Failed to connect to ssh server:', error);
			});
		} else {
			callback('Cannot connect to Ubiquiti device, please check settings!', null);
		}
	});
	socket.on('disconnect', () => {
		console.log('User aborted pairing, or pairing is finished');
	});
};

// this defines our apps capabilities.
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
	console.log('Initialize device:', deviceData.id);
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

// create an ssh connection and get AP config
function getClients() {
	const conn = new Client();
	let json = '';
	console.log('Gettting clients...');
	conn.on('ready', () => {
		conn.exec('mca-dump', (err, stream) => {
			if (err) console.error(err);
			stream.on('close', () => {
				conn.end();
				clients = formatClients(json);
				console.log(`Found ${Object.keys(clients).length} client(s).`);
			}).on('data', (jsonData) => {
				json += jsonData.toString();
			}).stderr.on('data', (error) => {
				Homey.log(`STDERR: ${error}`);
			});
		});
	});
	conn.connect({
		host: Homey.manager('settings').get('hostname'),
		username: Homey.manager('settings').get('username'),
		password: Homey.manager('settings').get('password'),
	});
	conn.on('error', (error) => {
		console.error('Failed to connect to ssh server:', error);
	});
}

// convert json to clients object
function formatClients(json, array) {
	const result = {};
	try {
		let data = JSON.parse(json);
		data.vap_table.forEach((radio) => {
			radio.sta_table.forEach((client) => {
				if (client.authorized) {
					let hostname = (client.hasOwnProperty('hostname')) ? client.hostname : client.mac;
					result[client.mac] = {
						name: (client.hasOwnProperty('hostname')) ? client.hostname : client.mac,
						data: {
							id: client.mac,
						},
						meta: {
							rssi: client.rssi,
						},
					}
				}
			});
		});
		return (array) ? Object.keys(result).map((key) => { return result[key]; }) : result;
	} catch (e) {
		Homey.log(`Invalid JSON in mca-dump [ ${e.toString()} ]`);
	}
}

// update status of specific device
function updateDevice(deviceData) {
	const device = getDeviceByData(deviceData);
	const client = clients[deviceData.id];
	if (client) {
		// Client found in client list, enable it if not already.
		if (device.state.client_connected !== true) {
			console.log(`Client ${deviceData.id} connected.`);
			device.state.client_connected = true;
			module.exports.realtime(deviceData, 'client_connected', true);
		}
		// only update when rssi has a difference bigger then 2
		if (compareInt(device.state.measure_rssi, client.meta.rssi, signalDiff)) {
			console.log(`Client ${deviceData.id} RSSI updated.`);
			device.state.measure_signal = client.meta.signal;
			module.exports.realtime(deviceData, 'measure_signal', formatDeviceData('signal', client.meta.rssi));
			device.state.measure_rssi = client.meta.rssi;
			module.exports.realtime(deviceData, 'measure_rssi', formatDeviceData('rssi', client.meta.rssi));
		}
	} else {
		if (device.state.client_connected !== false) {
			console.log(`Client ${deviceData.id} disconnected.`);
			device.state.client_connected = false;
			module.exports.realtime(deviceData, 'client_connected', false);
			device.state.measure_signal = null;
			module.exports.realtime(deviceData, 'measure_signal', null);
			device.state.measure_rssi = null;
			module.exports.realtime(deviceData, 'measure_rssi', null);
		}
	}
}

// gracefully borrowed from com.ubnt.unifi app
function formatDeviceData(type, value) {
	switch (type) {
		case 'signal':
			return parseInt((Math.min(45, Math.max(parseFloat(value), 5)) - 5) / 40 * 99);
		case 'rssi':
			return parseInt(parseFloat(value) - 95);
	}
}

// get client from client list by id(mac)
function findClient(id) {
	for (const key in clients) {
		if (clients[key].data.id === id) {
			return clients[key];
		}
	}
}

// get device from devices list by id(mac)
function getDeviceByData(deviceData) {
	const device = devices[deviceData.id];
	if (typeof device === 'undefined') {
		return new Error('invalid_device');
	}
	return device;
}

// check if integer difference is higher then diff.
function compareInt(a, b, diff) {
	if (parseInt(a) && parseInt(b)) {
		if (Math.abs(a - b) > diff) {
			return true;
		}
	} else {
		return true;
	}
}

// create or new or update and existing client poller.
function setClientPoller() {
	console.log('Setting a new client poller');
	let pollTimer = Homey.manager('settings').get('polltimer');
	if (parseInt(pollTimer)) {
		clearInterval(clientPoller);
		clientPoller = setInterval(() => {
			if (Object.keys(devices).length > 0 && checkSettings(connSettings)) {
				getClients();
			}
		}, (pollTimer * 60 * 1000));
	}
}

// check for updated settings and do some logic.
function settingsSaved(name) {
	console.log('Settings updated by user');
	if (name === 'polltimer') {
		setClientPoller();
	}
}

// checks an array of setting names to check if they are set
function checkSettings(settings) {
	let error = false;
	settings.forEach((setting) => {
		let value = Homey.manager('settings').get(setting);
		if (!value || 0 === value.length) {
			console.log(`Setting ${setting} is not set.`)
			error = true;
		}
	});
	return (error) ? false : true;
}
