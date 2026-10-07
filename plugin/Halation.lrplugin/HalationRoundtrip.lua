--[[----------------------------------------------------------------------------
The round trip:

  1. Export every selected photo as a 16-bit TIFF into a temp folder
     (develop settings baked in, no sharpening, no resizing).
  2. Write a JSON job file listing input/output pairs and launch the
     Halation editor app, blocking until it exits.
  3. Import every output the app produced into the catalog, stacked
     with its source photo, exactly like Lightroom's own "Edit In".
------------------------------------------------------------------------------]]

local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrExportSession = import 'LrExportSession'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrProgressScope = import 'LrProgressScope'
local LrTasks = import 'LrTasks'
local LrLogger = import 'LrLogger'
local LrDate = import 'LrDate'

local util = require 'HalationUtil'
local prefsModule = require 'HalationPrefs'

local log = LrLogger('Halation')
log:enable('logfile')

local M = {}

local function tempWorkDir()
	local base = LrPathUtils.child(LrPathUtils.getStandardFilePath('temp'), 'Halation')
	local dir = LrPathUtils.child(base, string.format('job-%d', math.floor(LrDate.currentTime())))
	LrFileUtils.createAllDirectories(dir)
	return dir
end

local function outputPathFor(photo)
	local src = photo:getRawMetadata('path')
	local folder = LrPathUtils.parent(src)
	local base = LrPathUtils.removeExtension(LrPathUtils.leafName(src))
	local candidate = LrPathUtils.child(folder, base .. '-Halation.tif')
	return LrFileUtils.chooseUniqueFileName(candidate)
end

local function exportPhotos(photos, workDir, prefs, progress)
	local session = LrExportSession {
		photosToExport = photos,
		exportSettings = {
			LR_exportServiceProvider = 'com.adobe.ag.export.file',
			LR_export_destinationType = 'specificFolder',
			LR_export_destinationPathPrefix = workDir,
			LR_export_useSubfolder = false,
			LR_collisionHandling = 'rename',
			LR_reimportExportedPhoto = false,

			LR_format = 'TIFF',
			LR_export_bitDepth = 16,
			LR_export_colorSpace = prefs.colorSpace,
			LR_tiff_compressionMethod = prefs.compression,
			LR_tiff_preserveTransparency = false,

			LR_size_doConstrain = false,
			LR_size_resolution = 300,
			LR_size_resolutionUnits = 'inch',
			LR_outputSharpeningOn = false,

			LR_embeddedMetadataOption = 'all',
			LR_minimizeEmbeddedMetadata = false,
			LR_removeLocationMetadata = false,
			LR_useWatermark = false,
			LR_includeVideoFiles = false,
		},
	}

	local items = {}
	local total = session:countRenditions()
	session:doExportOnCurrentTask()

	local i = 0
	for _, rendition in session:renditions() do
		i = i + 1
		progress:setPortionComplete(i - 1, total)
		progress:setCaption(string.format('Rendering %d of %d for Halation', i, total))
		local ok, pathOrMessage = rendition:waitForRender()
		if ok then
			local photo = rendition.photo
			items[#items + 1] = {
				photo = photo,
				input = pathOrMessage,
				output = outputPathFor(photo),
				name = LrPathUtils.leafName(photo:getRawMetadata('path')),
			}
		else
			log:warn('Render failed: ' .. tostring(pathOrMessage))
		end
		if progress:isCanceled() then return items, true end
	end
	return items, false
end

local function writeJob(items, workDir, prefs)
	local job = { version = 1, colorSpace = prefs.colorSpace, items = {} }
	for i, item in ipairs(items) do
		job.items[i] = { input = item.input, output = item.output, name = item.name }
	end
	local jobPath = LrPathUtils.child(workDir, 'job.json')
	util.writeFile(jobPath, util.toJson(job))
	return jobPath
end

local function importResults(items, prefs)
	local catalog = LrApplication.activeCatalog()
	local imported = 0
	catalog:withWriteAccessDo('Import Halation results', function()
		for _, item in ipairs(items) do
			if LrFileUtils.exists(item.output) == 'file' then
				if prefs.stackWithOriginal then
					catalog:addPhoto(item.output, item.photo, 'below')
				else
					catalog:addPhoto(item.output)
				end
				imported = imported + 1
			end
		end
	end, { timeout = 30 })
	return imported
end

function M.run()
	local prefs = prefsModule.get()
	local catalog = LrApplication.activeCatalog()
	local photos = catalog:getTargetPhotos()
	if #photos == 0 then
		LrDialogs.message('Halation', 'Select one or more photos first.', 'info')
		return
	end

	local executable, err = util.resolveExecutable(prefs.appPath)
	if not executable then
		LrDialogs.message('Halation app not found', err .. '\n\nSet the app location in File > Plug-in Manager > Halation.', 'critical')
		return
	end

	local workDir = tempWorkDir()
	local progress = LrProgressScope { title = 'Halation', functionContext = nil }
	progress:setCancelable(true)

	local items, canceled = exportPhotos(photos, workDir, prefs, progress)
	if canceled or #items == 0 then
		progress:done()
		if prefs.deleteTemp then LrFileUtils.delete(workDir) end
		return
	end

	local jobPath = writeJob(items, workDir, prefs)
	progress:setCaption('Editing in Halation...')
	progress:setIndeterminate()

	local cmd = util.buildCommand(executable, { '--job', jobPath })
	log:info('Launching: ' .. cmd)
	local exitCode = LrTasks.execute(cmd)
	log:info('Halation exited with ' .. tostring(exitCode))

	progress:setCaption('Importing results')
	local imported = importResults(items, prefs)
	progress:done()

	if prefs.deleteTemp then
		LrFileUtils.delete(workDir)
	end

	if imported == 0 and exitCode ~= 0 then
		LrDialogs.message('Halation', string.format('The Halation app exited with code %s and produced no output.', tostring(exitCode)), 'warning')
	end
end

return M
