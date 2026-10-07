--[[----------------------------------------------------------------------------
Small helpers: JSON writer (the Lightroom SDK ships no JSON library), shell
quoting and executable resolution for both platforms.
------------------------------------------------------------------------------]]

local LrPathUtils = import 'LrPathUtils'
local LrFileUtils = import 'LrFileUtils'

local M = {}

local escapes = {
	['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f',
	['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t',
}

local function encodeString(s)
	return '"' .. s:gsub('[%c"\\]', function(c)
		return escapes[c] or string.format('\\u%04x', c:byte())
	end) .. '"'
end

-- Minimal JSON encoder: strings, numbers, booleans, arrays (tables with
-- sequential integer keys starting at 1) and objects (string keys).
function M.toJson(value)
	local t = type(value)
	if t == 'string' then return encodeString(value) end
	if t == 'number' then return string.format('%.14g', value) end
	if t == 'boolean' then return value and 'true' or 'false' end
	if value == nil then return 'null' end
	if t == 'table' then
		if #value > 0 or next(value) == nil then
			local parts = {}
			for i = 1, #value do parts[i] = M.toJson(value[i]) end
			return '[' .. table.concat(parts, ',') .. ']'
		end
		local keys = {}
		for k in pairs(value) do keys[#keys + 1] = tostring(k) end
		table.sort(keys)
		local parts = {}
		for i, k in ipairs(keys) do
			parts[i] = encodeString(k) .. ':' .. M.toJson(value[k])
		end
		return '{' .. table.concat(parts, ',') .. '}'
	end
	error('Cannot encode value of type ' .. t)
end

function M.writeFile(path, contents)
	local f, err = io.open(path, 'wb')
	if not f then error('Could not write ' .. path .. ': ' .. tostring(err)) end
	f:write(contents)
	f:close()
end

-- Turn the path the user picked in Plug-in Manager into something that can be
-- executed and waited on. On macOS a .app bundle is resolved to its binary so
-- LrTasks.execute blocks until the editor window is closed.
function M.resolveExecutable(appPath)
	if not appPath or appPath == '' then return nil, 'No Halation app path configured.' end
	if MAC_ENV and appPath:sub(-4) == '.app' then
		local macos = LrPathUtils.child(LrPathUtils.child(appPath, 'Contents'), 'MacOS')
		if LrFileUtils.exists(macos) ~= 'directory' then
			return nil, 'The app bundle has no Contents/MacOS folder: ' .. appPath
		end
		for file in LrFileUtils.directoryEntries(macos) do
			if LrFileUtils.exists(file) == 'file' then return file end
		end
		return nil, 'No executable found inside ' .. appPath
	end
	if LrFileUtils.exists(appPath) ~= 'file' then
		return nil, 'Halation app not found at ' .. appPath
	end
	return appPath
end

local function quote(arg)
	if WIN_ENV then
		return '"' .. arg:gsub('"', '\\"') .. '"'
	end
	return "'" .. arg:gsub("'", "'\\''") .. "'"
end

-- Build a command line that LrTasks.execute will run synchronously.
function M.buildCommand(executable, args)
	local parts = { quote(executable) }
	for _, a in ipairs(args) do parts[#parts + 1] = quote(a) end
	local cmd = table.concat(parts, ' ')
	if WIN_ENV then
		-- cmd.exe strips one pair of outer quotes; wrap the whole line so the
		-- quoted executable path survives.
		cmd = '"' .. cmd .. '"'
	end
	return cmd
end

return M
