--[[----------------------------------------------------------------------------
Entry point for the "Edit in Halation..." menu items.
------------------------------------------------------------------------------]]

local LrTasks = import 'LrTasks'

local roundtrip = require 'HalationRoundtrip'

LrTasks.startAsyncTask(function()
	roundtrip.run()
end, 'Halation')
