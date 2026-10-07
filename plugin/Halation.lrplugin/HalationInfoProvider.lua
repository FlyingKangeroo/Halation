--[[----------------------------------------------------------------------------
Settings panel shown in File > Plug-in Manager.
------------------------------------------------------------------------------]]

local LrView = import 'LrView'
local LrDialogs = import 'LrDialogs'

local prefsModule = require 'HalationPrefs'

local bind = LrView.bind

local function sectionsForTopOfDialog(f, propertyTable)
	local prefs = prefsModule.get()

	return {
		{
			title = 'Halation editor',
			bind_to_object = prefs,

			f:row {
				spacing = f:control_spacing(),
				f:static_text { title = 'App location:', width = LrView.share 'label' },
				f:edit_field { value = bind 'appPath', width_in_chars = 40 },
				f:push_button {
					title = 'Browse...',
					action = function()
						local picked = LrDialogs.runOpenPanel {
							title = 'Locate the Halation app',
							canChooseFiles = true,
							canChooseDirectories = MAC_ENV, -- .app bundles are directories
							allowsMultipleSelection = false,
							fileTypes = WIN_ENV and { 'exe' } or { 'app' },
						}
						if picked and picked[1] then prefs.appPath = picked[1] end
					end,
				},
			},

			f:row {
				spacing = f:control_spacing(),
				f:static_text { title = 'Hand-off color space:', width = LrView.share 'label' },
				f:popup_menu {
					value = bind 'colorSpace',
					items = {
						{ title = 'sRGB (recommended)', value = 'sRGB' },
						{ title = 'Adobe RGB', value = 'AdobeRGB' },
						{ title = 'ProPhoto RGB', value = 'ProPhotoRGB' },
					},
				},
			},

			f:row {
				spacing = f:control_spacing(),
				f:static_text { title = 'Temp TIFF compression:', width = LrView.share 'label' },
				f:popup_menu {
					value = bind 'compression',
					items = {
						{ title = 'None (fastest)', value = 'compressionMethod_None' },
						{ title = 'ZIP', value = 'compressionMethod_ZIP' },
					},
				},
			},

			f:row {
				f:checkbox { title = 'Stack result with the original photo', value = bind 'stackWithOriginal' },
			},
			f:row {
				f:checkbox { title = 'Delete temporary files after import', value = bind 'deleteTemp' },
			},

			f:row {
				f:static_text {
					title = 'Photos are rendered as 16-bit TIFFs, opened in Halation, and the result is imported next to the original.',
				},
			},
		},
	}
end

return {
	sectionsForTopOfDialog = sectionsForTopOfDialog,
}
