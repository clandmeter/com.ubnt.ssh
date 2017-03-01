# com.ubnt.ssh
UniFi AP presence detection for Homey (SSH version)

This is an alternative implementation of [com.ubnt.unifi](https://github.com/mnederlof/com.ubnt.unifi) 
application without the need of the Ubiquiti UniFi® Controller software.
To setup your UniFi AP without the controller software you will need to
install one of the mobile apps on your Apple or Android device and [follow
the procedure](https://help.ubnt.com/hc/en-us/articles/226395988-UniFi-Managing-Access-Points-via-UniFi-Mobile-App).

When you have setup your UniFI AP, you can start installing this application and provide it with the following information:

* **Hostname** (Ip/Hostname of your UniFI AP)
* **Username** (Same as the username which you used in your mobile app) 
* **Password** (Same as the password which you used in your mobile app)
* **Poll Intervall** (The amount of time this app will query your UniFi AP)

When you provided the correct information you should now be able to add devices via "Add a device" in Homey.
Homey will automatically get a list of clients and provide you a list of device to choose from.

Limitations: This app only supports a single AP because having more then one
AP means more reason to install the controller software. Of course PR's are always welcome.
