Option Explicit

Dim shell, fso, appDir, electronPath

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronPath = appDir & "\node_modules\electron\dist\electron.exe"

shell.CurrentDirectory = appDir
shell.Run """" & electronPath & """ .", 0, False
