--[[----------------------------------------------------------------------------
Halation - open-source film grain, halation, bloom and damage for Lightroom Classic.

This is the plug-in manifest. Lightroom Classic reads it when the plug-in is
added in File > Plug-in Manager.
------------------------------------------------------------------------------]]

return {
	LrSdkVersion = 10.0,
	LrSdkMinimumVersion = 6.0,

	LrToolkitIdentifier = 'org.halation.lightroom',
	LrPluginName = 'Halation',
	LrPluginInfoUrl = 'https://github.com/FlyingKangeroo/Halation',

	LrPluginInfoProvider = 'HalationInfoProvider.lua',

	-- File > Plug-in Extras
	LrExportMenuItems = {
		{
			title = 'Edit in Halation...',
			file = 'HalationMenu.lua',
			enabledWhen = 'photosSelected',
		},
	},

	-- Library > Plug-in Extras
	LrLibraryMenuItems = {
		{
			title = 'Edit in Halation...',
			file = 'HalationMenu.lua',
			enabledWhen = 'photosSelected',
		},
	},

	VERSION = { major = 0, minor = 1, revision = 0, build = 0 },
}
