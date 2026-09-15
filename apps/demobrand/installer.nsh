; demobrand — include NSIS commun (client + serveur).
; Généré par @creezio/brand-config renderNsisInstallerInclude.
;
; 1) customCheckAppRunning : match EXACT du .exe (évite le faux positif
;    StartsWith entre TempoFlow et TempoFlow-Server).
; 2) Page d’options d’install : raccourci Bureau + démarrage Windows.
; 3) Page désinstall : case « supprimer toutes les données » (AppData réel).
;
; userData Electron ≠ APP_FILENAME NSIS :
;   Serveur → %APPDATA%\DemoBrand Server
;   Client  → %APPDATA%\demobrand

!include "nsProcess.nsh"
!include "nsDialogs.nsh"

; Compteur préprocesseur pour labels uniques (macros insérés plusieurs fois
; dans une même section — y compris via insertion imbriquée).
!define CREEZIO_NSIS_UID 0

; Vars séparées install / uninstall : makensis traite les « unused » en erreur
; (electron-builder warningsAsErrors).
!ifndef BUILD_UNINSTALLER
  Var czDesktopCheckbox
  Var czStartupCheckbox
  Var czWantDesktop
  Var czWantStartup
!else
  Var czDeleteDataCheckbox
  Var czWantDeleteData
!endif

!macro customInit
  StrCpy $czWantDesktop "1"
  StrCpy $czWantStartup "0"
!macroend

!macro customUnInit
  StrCpy $czWantDeleteData "0"
  ; Désinstall silencieuse / scriptée : honorer --delete-app-data
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    StrCpy $czWantDeleteData "1"
  ${EndIf}
!macroend

; Tue l'ARBRE de process TempoFlow : l'exe principal (/T = enfants directs)
; puis tout process orphelin dont l'exécutable vit sous le userData TempoFlow
; ou le dossier d'install (python venv Hermes, node n8n, meilisearch,
; cloudflared…). Sans ça, la désinstallation laisse des fichiers verrouillés
; (venv Hermes résiduel constaté en audit) et l'upgrade peut échouer.
!macro czKillProcessTree
  !insertmacro czResolveUserDataDir
  ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  ; Périmètre STRICT : userData TempoFlow + $INSTDIR uniquement. On ne tue
  ; jamais un process de %LOCALAPPDATA%\hermes — ce peut être le Hermes
  ; PERSONNEL de l'utilisateur, indépendant de TempoFlow.
  StrCpy $R7 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '*\$R9\*' -or $$_.ExecutablePath -like '$INSTDIR\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  ExecWait $R7
  Sleep 500
!macroend

!macro customCheckAppRunning
  ; $R0 = 0 → process trouvé (convention plugin nsProcess).
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${if} ${isUpdated}
      Sleep 1000
      Goto cz_stop_app
    ${endIf}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK cz_stop_app
    Quit

    cz_stop_app:
      DetailPrint "$(appClosing)"
      ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      Sleep 500
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        Sleep 500
      ${endIf}
      ; Embeds spawnés par l'app (python/node/meili) : kill de l'arbre complet,
      ; sinon fichiers verrouillés pendant l'upgrade / la purge.
      !insertmacro czKillProcessTree
  ${endIf}
!macroend

; ---------------------------------------------------------------------------
; Installation — options (Bureau + démarrage auto)
; ---------------------------------------------------------------------------

!macro customPageAfterChangeDir
  Page custom czInstallOptionsPage czInstallOptionsLeave
  Function czInstallOptionsPage
    ${if} ${isUpdated}
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "Options d'installation" "Raccourci Bureau et démarrage automatique"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0u 0u 100% 24u "Choisissez les options de démarrage pour ${PRODUCT_NAME} :"
    Pop $0

    ${NSD_CreateCheckbox} 0u 32u 100% 12u "Créer un raccourci sur le Bureau"
    Pop $czDesktopCheckbox
    ${If} $czWantDesktop == "1"
      ${NSD_Check} $czDesktopCheckbox
    ${EndIf}

    ${NSD_CreateCheckbox} 0u 52u 100% 24u "Lancer ${PRODUCT_NAME} automatiquement au démarrage de Windows"
    Pop $czStartupCheckbox
    ${If} $czWantStartup == "1"
      ${NSD_Check} $czStartupCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function czInstallOptionsLeave
    ${NSD_GetState} $czDesktopCheckbox $0
    ${If} $0 = ${BST_CHECKED}
      StrCpy $czWantDesktop "1"
    ${Else}
      StrCpy $czWantDesktop "0"
    ${EndIf}

    ${NSD_GetState} $czStartupCheckbox $0
    ${If} $0 = ${BST_CHECKED}
      StrCpy $czWantStartup "1"
    ${Else}
      StrCpy $czWantStartup "0"
    ${EndIf}
  FunctionEnd
!macroend

!macro czResolveUserDataDir
  ; Sortie : $R9 = segment userData sous %APPDATA%
  !define /redef /math CREEZIO_NSIS_UID ${CREEZIO_NSIS_UID} + 1
  !define czUdId ${CREEZIO_NSIS_UID}
  StrCmp "${APP_EXECUTABLE_FILENAME}" "DemoBrand-Server.exe" 0 cz_ud_client_${czUdId}
    StrCpy $R9 "DemoBrand Server"
    Goto cz_ud_done_${czUdId}
  cz_ud_client_${czUdId}:
    StrCpy $R9 "demobrand"
  cz_ud_done_${czUdId}:
  !undef czUdId
!macroend

; Suppression récursive rapide via cmd (évite le parcours fichier-par-fichier NSIS).
; Entrée : $R8 = chemin absolu du dossier à retirer.
; Retries : les embeds tout juste tués peuvent garder un verrou quelques
; centaines de ms (AV Windows compris). 3 tentatives + trace si résidu.
!macro czFastRemoveDir
  !define /redef /math CREEZIO_NSIS_UID ${CREEZIO_NSIS_UID} + 1
  !define czFrdId ${CREEZIO_NSIS_UID}
  IfFileExists "$R8\*" 0 cz_frd_done_${czFrdId}
    StrCpy $R7 '"$SYSDIR\cmd.exe" /c rmdir /s /q "$R8"'
    ExecWait $R7
    IfFileExists "$R8\*" 0 cz_frd_done_${czFrdId}
    Sleep 800
    ExecWait $R7
    IfFileExists "$R8\*" 0 cz_frd_done_${czFrdId}
    Sleep 1500
    ExecWait $R7
    IfFileExists "$R8\*" 0 cz_frd_done_${czFrdId}
    DetailPrint "AVERTISSEMENT : résidu non supprimé (fichier verrouillé ?) : $R8"
  cz_frd_done_${czFrdId}:
  !undef czFrdId
!macroend

!macro customInstall
  ; Ne pas écraser les préférences / raccourcis pendant un upgrade in-place.
  ${if} ${isUpdated}
    Goto cz_custom_install_done
  ${endif}

  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}

  ; electron-builder crée le raccourci Bureau par défaut → on le retire si décoché.
  ${if} $czWantDesktop == "0"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$newDesktopLink"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endif}

  !insertmacro czResolveUserDataDir
  CreateDirectory "$APPDATA\$R9"

  ; Prefs lues au 1er boot Electron (sync setLoginItemSettings + local-config).
  FileOpen $R8 "$APPDATA\$R9\installer-prefs.json" w
  FileWrite $R8 '{"launchAtStartup":'
  ${if} $czWantStartup == "1"
    FileWrite $R8 "true"
  ${else}
    FileWrite $R8 "false"
  ${endif}
  FileWrite $R8 ',"createDesktopShortcut":'
  ${if} $czWantDesktop == "1"
    FileWrite $R8 "true"
  ${else}
    FileWrite $R8 "false"
  ${endif}
  FileWrite $R8 "}$\r$\n"
  FileClose $R8

  ; Effet immédiat (même sans 1er lancement de l'app).
  ${if} $czWantStartup == "1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${SHORTCUT_NAME}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  ${else}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${SHORTCUT_NAME}"
  ${endif}

  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}

  cz_custom_install_done:
!macroend

; ---------------------------------------------------------------------------
; Désinstallation — choix de purger toutes les données
;
; Ne PAS poser la case sur MUI_UNPAGE_WELCOME : le label MUI recouvre le
; checkbox (clics sans effet). Page nsDialogs dédiée (dialog 1018) à la place.
; ---------------------------------------------------------------------------

!macro customUnWelcomePage
  UninstPage custom un.czUnOptionsPage un.czUnOptionsLeave

  Function un.czUnOptionsPage
    ${if} ${isUpdated}
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "Désinstaller ${PRODUCT_NAME}" "Choisissez si les données utilisateur doivent être effacées"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0u 0u 100% 48u "L'assistant va retirer ${PRODUCT_NAME} de cet ordinateur.$\r$\n$\r$\nPar défaut, vos données (catalogue, base, configuration) sont CONSERVÉES. Cochez la case uniquement si vous voulez vraiment tout effacer."
    Pop $0

    ${NSD_CreateCheckbox} 0u 60u 100% 28u "Supprimer définitivement toutes les données utilisateur (catalogue, base SQLite, configuration, n8n…)"
    Pop $czDeleteDataCheckbox
    ${If} $czWantDeleteData == "1"
      ${NSD_Check} $czDeleteDataCheckbox
    ${Else}
      ${NSD_Uncheck} $czDeleteDataCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function un.czUnOptionsLeave
    ${NSD_GetState} $czDeleteDataCheckbox $0
    ${If} $0 = ${BST_CHECKED}
      StrCpy $czWantDeleteData "1"
    ${Else}
      StrCpy $czWantDeleteData "0"
    ${EndIf}
  FunctionEnd
!macroend

!macro customUnInstall
  ; Pendant un upgrade, l'ancien désinstalleur est appelé avec --updated :
  ; ne JAMAIS purger AppData dans ce cas.
  ${if} ${isUpdated}
    Goto cz_custom_uninstall_done
  ${endif}

  ${if} $czWantDeleteData != "1"
    Goto cz_custom_uninstall_done
  ${endif}

  DetailPrint "Arrêt des process (embeds compris)…"

  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}

  ; PC vierge = aucun process TempoFlow survivant (sinon venv Hermes / node
  ; n8n verrouillés → résidus disque constatés en audit).
  !insertmacro czKillProcessTree

  DetailPrint "Suppression rapide des données utilisateur…"

  !insertmacro czResolveUserDataDir
  StrCpy $R8 "$APPDATA\$R9"
  !insertmacro czFastRemoveDir
  StrCpy $R8 "$LOCALAPPDATA\$R9"
  !insertmacro czFastRemoveDir

  ; Chemins NSIS / Electron historiques éventuels (best-effort, ciblés).
  !ifdef APP_PACKAGE_NAME
    StrCpy $R8 "$APPDATA\${APP_PACKAGE_NAME}"
    !insertmacro czFastRemoveDir
    StrCpy $R8 "$LOCALAPPDATA\${APP_PACKAGE_NAME}"
    !insertmacro czFastRemoveDir
    ; Cache electron-updater (installeurs .exe téléchargés) — sinon résidu
    ; de plusieurs centaines de Mo après désinstallation.
    StrCpy $R8 "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    !insertmacro czFastRemoveDir
  !endif
  !ifdef APP_PRODUCT_FILENAME
    StrCpy $R8 "$APPDATA\${APP_PRODUCT_FILENAME}"
    !insertmacro czFastRemoveDir
    StrCpy $R8 "$LOCALAPPDATA\${APP_PRODUCT_FILENAME}"
    !insertmacro czFastRemoveDir
  !endif
  StrCpy $R8 "$APPDATA\${APP_FILENAME}"
  !insertmacro czFastRemoveDir
  StrCpy $R8 "$LOCALAPPDATA\${APP_FILENAME}"
  !insertmacro czFastRemoveDir

  ; NE JAMAIS purger %LOCALAPPDATA%\hermes ni %APPDATA%\uv :
  ; Hermes personnel utilisateur hors périmètre.

  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${SHORTCUT_NAME}"

  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}

  cz_custom_uninstall_done:
!macroend
