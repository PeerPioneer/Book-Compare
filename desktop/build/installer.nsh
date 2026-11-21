; Book Compare installer: an extra page after "Choose Install Location" with two tick boxes,
; "Start menu" and "Desktop" (owner, 21 Nov 2026: a desktop program usually asks this).
; The standard installer (electron-builder) creates both shortcuts; afterwards the ones that were NOT ticked are removed again.
; This keeps the standard uninstaller in charge of removing them. A silent install (/S) shows no page and keeps both.
!include nsDialogs.nsh
!include LogicLib.nsh

!macro customPageAfterChangeDir
  Var BcStartBox
  Var BcDeskBox
  Var BcStart
  Var BcDesk
  Page custom BcShortcutsPage BcShortcutsLeave

  Function BcShortcutsPage
    ${If} ${isUpdated}
      Abort                                   ; an update keeps the choice made at the first installation
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Shortcuts" "Where should Book Compare appear?"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 20u "Book Compare can be started from the Start menu, from an icon on the Desktop, or both."
    Pop $0
    ${NSD_CreateCheckbox} 0 28u 100% 12u "Add Book Compare to the &Start menu"
    Pop $BcStartBox
    ${NSD_Check} $BcStartBox
    ${NSD_CreateCheckbox} 0 46u 100% 12u "Put a Book Compare icon on the &Desktop"
    Pop $BcDeskBox
    ${NSD_Check} $BcDeskBox
    nsDialogs::Show
  FunctionEnd

  Function BcShortcutsLeave
    ${NSD_GetState} $BcStartBox $BcStart
    ${NSD_GetState} $BcDeskBox $BcDesk
  FunctionEnd
!macroend

!macro customInstall
  ; $BcStart / $BcDesk are "0" only when the box was shown and NOT ticked
  ${If} $BcDesk == "0"
    Delete "$newDesktopLink"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
  ${If} $BcStart == "0"
    Delete "$newStartMenuLink"
    StrCpy $launchLink "$appExe"              ; "Run Book Compare" on the last page starts the program itself
  ${EndIf}
!macroend
