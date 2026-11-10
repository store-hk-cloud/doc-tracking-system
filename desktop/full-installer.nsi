!include "MUI2.nsh"

Name "Hillkoff Document Tracking"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\Hillkoff Document Tracking"
ShowInstDetails show

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Hillkoff Document Tracking"
FunctionEnd

Section "Hillkoff Document Tracking"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${PROJECT_DIR}\..\build\desktop\win-unpacked\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Hillkoff Document Tracking.lnk" "$INSTDIR\Hillkoff Document Tracking.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HillkoffDocumentTracking" "DisplayName" "Hillkoff Document Tracking"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HillkoffDocumentTracking" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HillkoffDocumentTracking" "Publisher" "Hillkoff"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HillkoffDocumentTracking" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
SectionEnd

Function un.onInit
  StrCmp $INSTDIR "$LOCALAPPDATA\Programs\Hillkoff Document Tracking" +2
  Abort
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\Hillkoff Document Tracking.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HillkoffDocumentTracking"
  RMDir /r "$INSTDIR"
SectionEnd
