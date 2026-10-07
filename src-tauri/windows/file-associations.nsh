; Quote the executable as well as the document argument. The upstream NSIS
; association template quotes only %1, which is unsafe for install paths with spaces.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\mdReader.Markdown\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend
