/*
 * View model for OctoPrint-Levelingguide
 *
 * Author: 3DXFAB
 * License: AGPLv3
 */

function gcd(a, b) {
	return (b) ? gcd(b, a % b) : a;
}
var decimalToFraction = function (_decimal) {
	_decimal = _decimal.toFixed(2);
	if (_decimal == parseInt(_decimal)) {
		return {
			top: parseInt(_decimal),
			bottom: 1,
			display: parseInt(_decimal) + '/' + 1
		};
	}
	else {
		var top = _decimal.toString().includes(".") ? _decimal.toString().replace(/\d+[.]/, '') : 0;
		var bottom = Math.pow(10, top.toString().replace('-','').length);
		if (_decimal >= 1) {
			top = +top + (Math.floor(_decimal) * bottom);
		}
		else if (_decimal <= -1) {
			top = +top + (Math.ceil(_decimal) * bottom);
		}

		var x = Math.abs(gcd(top, bottom));
		return {
			top: (top / x),
			bottom: (bottom / x),
			display: (top / x) + '/' + (bottom / x)
		};
	}
};

function perc2color(perc,min,max) {
	var base = (max - min);

	if (base == 0) { perc = 100; }
	else {
		perc = (perc - min) / base * 100; 
	}
	var r, g, b = 0;
	if (perc < 50) {
		r = 255;
		g = Math.round(5.1 * perc);
	}
	else {
		g = 255;
		r = Math.round(510 - 5.10 * perc);
	}
	var h = r * 0x10000 + g * 0x100 + b * 0x1;
	return '#' + ('000000' + h.toString(16)).slice(-6);
}

$(function() {
	function BearLevelingGuideViewModel(parameters) {
		var self = this;

		self.loginStateViewModel = parameters[0];
		self.settingsViewModel = parameters[1];
		self.controlViewModel = parameters[2];
		self.printerStateViewModel = parameters[3];
		self.temperatureViewModel = parameters[4];
		

		// state variables
		self.isRunning = ko.observable(false);
		self.isPaused = ko.observable(false);
		
		// settings and DOM data
		self.enablePreheat = ko.observable(true);
		self.enablePreheatNozzle = ko.observable(true);
		self.enablePreheatBed = ko.observable(true);
		self.selectedProfile = ko.observable();
		self.availableProfiles = ko.observableArray([]);
		self.currentStatus = ko.observable('Idle');
		self.viewType = ko.observable('table');
		self.selectedView = ko.observable();
		self.bedTemperature = ko.observable('');
		self.nozzleTemperature = ko.observable('');
		
		
		// Data from MT
		self.routeData = {};
		self.bedVariance = ko.observable();
		self.lastUpdated = ko.observable();
		self.maxValue = null;
		self.bedValues = ko.observableArray([]);
		
		// JS helpers
		self.waitTimer = null;
		
		self.switchToTable = function () {
			self.viewType("table");
		}
		
		self.switchToReal = function () {
			self.viewType("real");
		}

		// initialization
		self.onStartupComplete = function () {

			self.heatbedImage = new Image();
			self.heatbedImage.onload = () => {
				self.ctx.clearRect(0, 0, dimensions.x, dimensions.y);
				// draw the heatbed image
				self.ctx.drawImage(self.heatbedImage, 50, 0);
			};
			self.heatbedImage.src = 'plugin/BearLevelingGuide/static/img/photo_heatbed.png';

			// populate available profiles in dropdown
			self.availableProfiles(self.settingsViewModel.temperature_profiles());

			// sort by extruder temperature
			self.availableProfiles(self.availableProfiles().sort(function (a, b) { return (a.extruder > b.extruder) ? 1 : -1}));
			
			self.currentSettings = self.settingsViewModel.settings.plugins.BearLevelingGuide;
			// if we have stored preheat settings or selected profile, select them in the DOM
			if (self.currentSettings.enable_preheat) {
				self.enablePreheat(self.currentSettings.enable_preheat());
			}
			if (self.currentSettings.enable_preheat_bed) {
				self.enablePreheatBed(self.currentSettings.enable_preheat_bed());
			}
			if (self.currentSettings.enable_preheat_nozzle) {
				self.enablePreheatNozzle(self.currentSettings.enable_preheat_nozzle());
			}
			if (self.currentSettings.selected_view) {
				self.selectedView(self.currentSettings.selected_view());
			}
			if (self.currentSettings.view_type) {
				self.viewType(self.currentSettings.view_type());
			}
			
			
			// subscribe to observables to save the new values
			self.enablePreheat.subscribe(function (newValue) {
				self.currentSettings.enable_preheat(self.enablePreheat());
			});

			self.enablePreheatNozzle.subscribe(function (newValue) {
				self.currentSettings.enable_preheat_nozzle(self.enablePreheatNozzle());
			});

			self.enablePreheatBed.subscribe(function (newValue) {
				self.currentSettings.enable_preheat_bed(self.enablePreheatBed());
			});
			
			self.selectedProfile.subscribe(function (newValue) {
				
				var profile = self.availableProfiles().filter(function (obj) {
					return obj.name == self.selectedProfile()
				});

				if (profile.length) {
					profile = profile[0];
					self.bedTemperature(profile.bed);
					self.nozzleTemperature(profile.extruder);
				}

				self.currentSettings.selected_profile(newValue);
			});
			if (self.currentSettings.selected_profile) {
				self.selectedProfile("");
				self.selectedProfile(self.currentSettings.selected_profile());
			}
			else if (self.availableProfiles().length) {
				self.selectedProfile("");
				self.selectedProfile(self.availableProfiles()[0].name);
			}
			
			self.selectedView.subscribe(function (newValue) {
				self.currentSettings.selected_view(newValue);
			});
			
			self.viewType.subscribe(function (newValue) {
				self.currentSettings.view_type(newValue);
			});
			
			
			
			self.selectedView.subscribe(function (newValue) {
				self.updateBedValues();
			})
			
			// fetch initial object
			$('#refreshBtn i').addClass('fa-spin');
			OctoPrint.simpleApiGet("BearLevelingGuide")
				.done(function(response) {
					$('#refreshBtn i').removeClass('fa-spin');
					// create an observable from the GET response
					self.routeData = ko.observable(response);
					
					if (response.values.length) {
						self.updateBedValues();
					}
					
					// subscribe to the observable to populate values on the DOM
					self.routeData.subscribe(self.updateBedValues);
				});

			self.canvas = document.getElementById("BearLevelingGuide-bedLayout");
			self.ctx = self.canvas.getContext("2d");
			self.ctx.font = '900 18px "Font Awesome 5 Free"';
		}
 
 		self.convertToDecimalTurns = function (value) {
 			var turns = (value / 0.5);
 			return  turns;
 		}
 		
		self.convertToDegrees = function (value) {
			var degrees = ((value / 0.5) * 360);
			return degrees;
		}
		
		self.updateBedValueDirection = function (point, value) {
			if (value == 0) {
				$('.bedvalue-' + point + '-direction').addClass('fa-bullseye');
			}
			else {
				$('.bedvalue-' + point + '-direction').addClass((value < 0) ? 'fa-undo' : 'fa-repeat');
			}
		}

		// Update the DOM with bed values from the API
		self.updateBedValues = function () {
			var data = self.routeData();


			if (!data.values.length) {
				return;
			}
			
			self.bedVariance(data.bed_variance);
			$('.variance strong').css('border-color', perc2color(1 - data.bed_variance, 0, 1.5));

			
			let maxValue = 0;
			for (i = 0; i < data.values.length; i++) {
				if (Math.abs(data.values[i]) > maxValue) {
					maxValue = Math.abs(data.values[i]);
				}
			}
			
			var newBedValues = [];
			for (i = 0; i < data.values.length; i++) {
				let valueColor = perc2color(Math.abs(data.values[i]), maxValue, 0);
				$('.bedvalue-' + i).css('border', '1px solid ' + valueColor);
				
				// center point, so just use 0
				if (i == 4) {
					newBedValues.push(0);
					continue;
				}
				// remove the icons at first
				$('.bedvalue-' + i + '-direction').removeClass('fa-repeat fa-undo fa-bullseye');
				
				// determine which view we are using, calculate our value
				// set our appropriate icon, then add it to the array to update the DOM
				if (self.selectedView() == "degrees") {
					var value = self.convertToDegrees(data.values[i]);
					newBedValues.push(Math.abs(value).toFixed(1)  + '°');
				}
				else if (self.selectedView() == "decimal") {
					var value = self.convertToDecimalTurns(data.values[i]);
					newBedValues.push(Math.abs(value).toFixed(3));
				}
				else if (self.selectedView() == "fraction") {
					var value = self.convertToDecimalTurns(data.values[i]);
					var fraction = decimalToFraction(value);
					if (fraction.top == 0) {
						newBedValues.push(0);
					}
					else {
						newBedValues.push(Math.abs(fraction.top) + '/' + fraction.bottom);
					}
				}
				else {
					newBedValues.push(data.values[i].toFixed(5));
				}

				self.updateBedValueDirection(i, data.values[i]);
				
				
			}
			
			self.bedValues(newBedValues);
			var d = new Date(data.last_result * 1000);
			
			self.lastUpdated(d.toLocaleString());

		}
		
		self.refreshFromAPI = function () {
			$('#refreshBtn i').addClass('fa-spin');
			OctoPrint.simpleApiGet("BearLevelingGuide")
				.done(function(response) {
					self.routeData(response);
					$('#refreshBtn i').removeClass('fa-spin');
				});
		}
		
		// actually send the configured leveling command
		self.sendLevelCommand = function () {
			// This is so fast we probably never see the status
			self.currentStatus('Sending mesh level gcode');
			levelGcode = self.currentSettings.mesh_gcode();

			// Send the configured gcode
			OctoPrint.control.sendGcode(levelGcode.split("\n"));
			
			self.currentStatus('Waiting for Mesh Bed Leveling to complete');
			
			// Create a timer to check the route for updated mesh values
			self.waitTimer = setInterval(function () {
				OctoPrint.simpleApiGet("BearLevelingGuide")
				.done(function(response) {
					
					if (self.routeData().last_result != response.last_result) {
						// If we actually have new data, we are waiting to continue adjustment
						self.currentStatus('Results obtained, make adjustments now.  When ready, click continue below.');
						
						// move the extruder out of the way to make adjustments
						OctoPrint.control.sendGcode(self.currentSettings.move_gcode());
						self.isPaused(true);
						
						// We should always have a timer handle, but we'll check to be safe
						if (self.waitTimer) {
							clearInterval(self.waitTimer);
							self.waitTimer = null;
						}
						
						// Update the route data, which triggers the observable subscribe and calls updateBedValues
						self.routeData(response);
					}
				});
			}, 2000); // Check every 2 seconds
		}
		
		// This is called when the user clicks finished and finishes up the adjustment proocess
		self.finishedLeveling = function () {
			self.currentStatus('Idle');
			self.isRunning(false);
			self.isPaused(false);
			// If we were preheated, we better disable it
			if (self.enablePreheat()) {
				self.temperatureViewModel.setTargetToZero(self.temperatureViewModel.tools()[0]);
				self.temperatureViewModel.setTargetToZero(self.temperatureViewModel.bedTemp);
			}
		}

		// This begins the process of adjusting
		self.beginAdjustment = function() {
			// save the current settings
			self.settingsViewModel.saveData();
			
			self.isRunning(true);
			
			// If we should prehead
			if (self.enablePreheat()) {

				if (!self.enablePreheatBed() && !self.enablePreheatNozzle()) {
					self.isRunning(false);
					self.currentStatus('Preheating selected, but preheating nozzle and bed disabled');
					return;
				}

				// Filter the available temperature profiles and find the selected one
				var profile = self.availableProfiles().filter(function (obj) {
					return obj.name == self.selectedProfile()
				});

				if (profile.length) {
					profile = profile[0];
				}
				else {
					// If for some strange reason we can't find the profile, error and exit
					console.error('could not find selected profile');
					self.isRunning(false);
					self.currentStatus('Idle');
					return;
				}
				
				// Set the bed and extruder temperatures from the profile

				if (self.enablePreheatNozzle()) {
					self.temperatureViewModel.setTargetFromProfile(self.temperatureViewModel.tools()[0], profile);
				}
				if (self.enablePreheatBed()) {
					self.temperatureViewModel.setTargetFromProfile(self.temperatureViewModel.bedTemp, profile);
				}
				
				self.currentStatus('Preheating');
				// check if we are preheated
				
				// Set a timer to check for being done preheating
				var timer = setInterval(function () {
					// Check if we're preheated

					if ((!self.enablePreheatNozzle() || self.temperatureViewModel.tools()[0].actual() >= profile.extruder) &&
						(!self.enablePreheatBed() || self.temperatureViewModel.bedTemp.actual() >= profile.bed)) {
							// we are preheated!
							self.sendLevelCommand();
							clearInterval(timer);
						}
				}, 3000); // check every 3 seconds
				
			}
			else {
				// We're not preheating, so we just send the command
				self.sendLevelCommand();
			}
		};
	}

	/* view model class, parameters for constructor, container to bind to
	 * Please see http://docs.octoprint.org/en/master/plugins/viewmodels.html#registering-custom-viewmodels for more details
	 * and a full list of the available options.
	 */
	OCTOPRINT_VIEWMODELS.push({
		construct: BearLevelingGuideViewModel,
		// ViewModels your plugin depends on, e.g. loginStateViewModel, settingsViewModel, ...
		dependencies: [ "loginStateViewModel", "settingsViewModel", "controlViewModel", "printerStateViewModel", "temperatureViewModel"],
		// Elements to bind to, e.g. #settings_plugin_levelingguide, #tab_plugin_levelingguide, ...
		elements: [ "#settings_plugin_BearLevelingGuide", "#tab_plugin_BearLevelingGuide" ]
	});
});
