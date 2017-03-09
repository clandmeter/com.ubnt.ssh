# com.ubnt.ssh
Ubiquiti UniFi® presence detection for Homey (SSH version)

## Description

This is an alternative implementation of [com.ubnt.unifi](https://github.com/mnederlof/com.ubnt.unifi) 
application without the need of the Ubiquiti UniFi® Controller software.
To setup your UniFi device without the controller software you will need to
install one of the mobile apps on your Apple or Android device and [follow
the procedure](https://help.ubnt.com/hc/en-us/articles/226395988-UniFi-Managing-Access-Points-via-UniFi-Mobile-App).

## Usage

When you have setup your UniFi® device, you can start installing this application and provide it with the following information:

* **Hostname** (Ip/Hostname of your UniFi® device)
* **Username** (Same as the username which you used in your mobile app) 
* **Password** (Same as the password which you used in your mobile app)
* **Poll Intervall** (The amount of time between device queries)

When you provided the correct information you should be able to add devices via "Add a device" in Homey.
Homey will query your UniFi® device and provide you a list with currently connected devices to choose from.

## Limitations

* This app only supports a single device because having more then one AP means more reason to install the controller software. Of course PR's are always welcome.
* You are only able to add devices/clients which are currently connected to your UniFi® device.

## Debug

Debugging can be enabled by creating a file or directory named debug in the root of this application.