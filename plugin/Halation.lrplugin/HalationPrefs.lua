--[[----------------------------------------------------------------------------
Plug-in preferences with defaults. Stored by Lightroom per plug-in.
------------------------------------------------------------------------------]]

local LrPrefs = import 'LrPrefs'

local prefs = LrPrefs.prefsForPlugin()

local function defaultAppPath()
	if WIN_ENV then
		-- The Tauri NSIS installer puts per-user installs under %LOCALAPPDATA%\Programs.
		local localAppData = os.getenv('LOCALAPPDATA') or 'C:\\Program Files'
		return localAppData .. '\\Programs\\Halation\\Halation.exe'
	else
		return '/Applications/Halation.app'
	end
end

local M = {}

function M.get()
	if prefs.appPath == nil or prefs.appPath == '' then prefs.appPath = defaultAppPath() end
	if prefs.colorSpace == nil then prefs.colorSpace = 'sRGB' end
	if prefs.compression == nil then prefs.compression = 'compressionMethod_None' end
	if prefs.stackWithOriginal == nil then prefs.stackWithOriginal = true end
	if prefs.deleteTemp == nil then prefs.deleteTemp = true end
	return prefs
end

return M
