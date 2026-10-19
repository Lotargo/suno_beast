#ifndef AppVersion
  #error AppVersion must be supplied by the build script
#endif

[Setup]
AppId={code:SetupId}
AppName=Suno Beast
AppVersion={#AppVersion}
AppPublisher=Lotargo
AppPublisherURL=https://github.com/Lotargo/suno_beast
DefaultDirName={localappdata}\Programs\SunoBeast
DefaultGroupName=Suno Beast
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=Suno-Beast-v{#AppVersion}-Windows-x64-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UsePreviousLanguage=no
DisableProgramGroupPage=yes
AllowNoIcons=yes
CloseApplications=no
RestartApplications=no
LicenseFile={#SourceDir}\LICENSE
SetupIconFile={#SourceDir}\app.ico
UninstallDisplayName=Suno Beast
UninstallDisplayIcon={app}\app.ico

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
russian.OpenGuide=Открыть инструкцию подключения расширения
english.OpenGuide=Open browser extension setup instructions
russian.GuideShortcut=Подключить расширение в браузере
english.GuideShortcut=Set up the browser extension
russian.Occupied=Выберите пустую папку или папку программы, ранее установленной этим установщиком. Существующие файлы и папки с исходниками не будут перезаписаны.
english.Occupied=Choose an empty folder or a program folder previously created by this installer. Existing files and source checkouts will not be overwritten.
russian.CheckFailed=Не удалось проверить встроенные компоненты. Установка отменена. Повторите установку и проверьте журнал.
english.CheckFailed=Bundled component verification failed. Installation was cancelled. Retry setup and check its log.
russian.RegisterFailed=Не удалось изменить регистрацию аудиопомощника. Подробности — в журнале установки или удаления.
english.RegisterFailed=Could not update the audio helper registration. See the setup or uninstall log for details.

[Files]
Source: "{#SourceDir}\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\native\*"; DestDir: "{app}\native"; Flags: ignoreversion
Source: "{#SourceDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "{#SourceDir}\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\app.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\runtime-info.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\registration-empty.ini"; Flags: dontcopy
Source: "{tmp}\registration-final.ini"; DestDir: "{app}"; DestName: "registration-backup.ini"; Flags: external ignoreversion
Source: "{tmp}\com.sunobeast.audio.json"; DestDir: "{app}\native"; Flags: external ignoreversion
Source: "{tmp}\installer-scope.txt"; DestDir: "{app}"; Flags: external ignoreversion
Source: "{tmp}\GettingStarted.txt"; DestDir: "{app}"; Flags: external ignoreversion

[Icons]
Name: "{group}\{cm:GuideShortcut}"; Filename: "{app}\GettingStarted.txt"
Name: "{group}\Uninstall Suno Beast"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\GettingStarted.txt"; Description: "{cm:OpenGuide}"; Flags: shellexec postinstall skipifsilent

[Code]
var
  ScopeId, BackupFile: String;
  PreviousPaths: array[0..1] of String;
  PreviousExists, RegistrationChanged: array[0..1] of Boolean;
  BackupBefore: AnsiString;
  RegistrationStarted, SetupSucceeded, BackupExisted, BundleChecked: Boolean;

function ValidScope(Value: String): Boolean;
var I: Integer;
begin
  Result := (Value = '') or (Length(Value) = 32);
  if Result then
    for I := 1 to Length(Value) do
      if Pos(Value[I], '0123456789abcdef') = 0 then Result := False;
end;

function SetupId(Param: String): String;
begin
  ScopeId := ExpandConstant('{param:SBTESTID|}');
  if not ValidScope(ScopeId) then RaiseException('Invalid isolated test ID');
  Result := 'SunoBeast';
  if ScopeId <> '' then Result := Result + '-Test-' + ScopeId;
end;

function RegistryBase(Param: String): String;
begin
  Result := 'Software';
  if ScopeId <> '' then Result := Result + '\SunoBeastInstallerTests\' + ScopeId;
end;

function HostKey(Index: Integer): String;
begin
  if Index = 0 then Result := RegistryBase('') + '\Google\Chrome'
  else Result := RegistryBase('') + '\Microsoft\Edge';
  Result := Result + '\NativeMessagingHosts\com.sunobeast.audio';
end;

procedure CheckBundle; forward;
procedure PrepareHelper; forward;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var SavedScope: AnsiString; FindRec: TFindRec;
begin
  Result := '';
  if DirExists(ExpandConstant('{app}\.git')) or FileExists(ExpandConstant('{app}\.git')) then begin
    Result := CustomMessage('Occupied');
    Exit;
  end;
  if not (FileExists(ExpandConstant('{app}\installer-scope.txt')) and FileExists(ExpandConstant('{app}\unins000.exe'))) then
    if FindFirst(ExpandConstant('{app}\*'), FindRec) then begin
      try
        repeat
          if (FindRec.Name <> '.') and (FindRec.Name <> '..') then Result := CustomMessage('Occupied');
        until not FindNext(FindRec);
      finally FindClose(FindRec); end;
      if Result <> '' then Exit;
    end;
  if FileExists(ExpandConstant('{app}\installer-scope.txt')) then begin
    if not LoadStringFromFile(ExpandConstant('{app}\installer-scope.txt'), SavedScope) then
      Result := CustomMessage('Occupied')
    else if Trim(String(SavedScope)) <> ScopeId then Result := CustomMessage('Occupied');
  end;
  if Result <> '' then Exit;
  try
    CheckBundle;
    PrepareHelper;
  except
    Log(GetExceptionMessage);
    Result := CustomMessage('CheckFailed');
  end;
end;

procedure RollbackRegistration;
var I: Integer; Current, Expected: String;
begin
  if not RegistrationStarted then Exit;
  Expected := ExpandConstant('{app}\native\com.sunobeast.audio.json');
  for I := 0 to 1 do
    if RegistrationChanged[I] and RegQueryStringValue(HKCU, HostKey(I), '', Current) and
      (CompareText(Current, Expected) = 0) then begin
      if PreviousExists[I] then begin
        if not RegWriteStringValue(HKCU, HostKey(I), '', PreviousPaths[I]) then
          Log('Could not restore the previous helper registration: ' + HostKey(I));
      end else begin
        RegDeleteValue(HKCU, HostKey(I), '');
        RegDeleteKeyIfEmpty(HKCU, HostKey(I));
      end;
    end;
  if FileExists(ExpandConstant('{app}\registration-backup.ini')) then begin
    if BackupExisted then begin
      if not SaveStringToFile(ExpandConstant('{app}\registration-backup.ini'), BackupBefore, False) then
        Log('Could not restore the registration backup');
    end else DeleteFile(ExpandConstant('{app}\registration-backup.ini'));
  end;
  RegistrationStarted := False;
end;

procedure RegisterHelper;
var I: Integer; Expected, Section, HadValue: String;
begin
  Expected := ExpandConstant('{app}\native\com.sunobeast.audio.json');
  BackupFile := ExpandConstant('{tmp}\registration-final.ini');
  BackupExisted := FileExists(ExpandConstant('{app}\registration-backup.ini'));
  if BackupExisted then begin
    if not FileCopy(ExpandConstant('{app}\registration-backup.ini'), BackupFile, False) then
      RaiseException(CustomMessage('RegisterFailed'));
  end else begin
    ExtractTemporaryFile('registration-empty.ini');
    if not FileCopy(ExpandConstant('{tmp}\registration-empty.ini'), BackupFile, False) then
      RaiseException(CustomMessage('RegisterFailed'));
  end;
  if not LoadStringFromFile(BackupFile, BackupBefore) then RaiseException(CustomMessage('RegisterFailed'));
  for I := 0 to 1 do begin
    RegistrationChanged[I] := False;
    PreviousPaths[I] := '';
    PreviousExists[I] := RegQueryStringValue(HKCU, HostKey(I), '', PreviousPaths[I]);
    if RegValueExists(HKCU, HostKey(I), '') and not PreviousExists[I] then
      RaiseException(CustomMessage('RegisterFailed'));
  end;
  RegistrationStarted := True;
  try
    for I := 0 to 1 do begin
      Section := IntToStr(I);
      { Preserve the original backup when upgrading an already-owned registration. }
      if (CompareText(PreviousPaths[I], Expected) <> 0) or not IniKeyExists(Section, 'HadValue', BackupFile) then begin
        HadValue := '0';
        if PreviousExists[I] and (CompareText(PreviousPaths[I], Expected) <> 0) then HadValue := '1';
        if not SetIniString(Section, 'HadValue', HadValue, BackupFile) or
          not SetIniString(Section, 'Path', PreviousPaths[I], BackupFile) then
          RaiseException(CustomMessage('RegisterFailed'));
      end;
    end;
    for I := 0 to 1 do begin
      if not RegWriteStringValue(HKCU, HostKey(I), '', Expected) then RaiseException(CustomMessage('RegisterFailed'));
      RegistrationChanged[I] := True;
      { Fault injection is restricted to the isolated registry test scope. }
      if (I = 0) and (ScopeId <> '') and
        (ExpandConstant('{param:SBTESTFAIL|}') = 'after-first-registration') then
        RaiseException('Isolated test: registration rollback');
    end;
  except
    RollbackRegistration;
    RaiseException(CustomMessage('RegisterFailed'));
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then begin
    try
      RegisterHelper;
    except
      Log(GetExceptionMessage);
      SuppressibleMsgBox(CustomMessage('RegisterFailed'), mbError, MB_OK, IDOK);
      Abort;
    end;
  end;
  if CurStep = ssDone then SetupSucceeded := True;
end;

procedure DeinitializeSetup;
begin
  if not SetupSucceeded then RollbackRegistration;
end;

function JsonPath(Value: String): String;
begin
  StringChangeEx(Value, '\', '\\', True);
  StringChangeEx(Value, '"', '\"', True);
  Result := Value;
end;

procedure ExtractCheckFile(Name, Relative: String);
var Destination: String;
begin
  ExtractTemporaryFile(Name);
  Destination := ExpandConstant('{tmp}\bundle-check\') + Relative;
  if not ForceDirectories(ExtractFileDir(Destination)) or
    not FileCopy(ExpandConstant('{tmp}\') + Name, Destination, False) then
    RaiseException(CustomMessage('CheckFailed'));
end;

procedure CheckBundle;
var ExitCode: Integer; CheckRoot: String;
begin
  if BundleChecked then Exit;
  ExtractCheckFile('node.exe', 'runtime\node.exe');
  ExtractCheckFile('ffmpeg.exe', 'runtime\ffmpeg.exe');
  ExtractCheckFile('ffprobe.exe', 'runtime\ffprobe.exe');
  ExtractCheckFile('runtime.js', 'native\runtime.js');
  ExtractCheckFile('self-check.js', 'native\self-check.js');
  ExtractCheckFile('manifest.json', 'extension\manifest.json');
  ExtractCheckFile('icon-128.png', 'extension\assets\icon-128.png');
  CheckRoot := ExpandConstant('{tmp}\bundle-check');
  if (ScopeId <> '') and (ExpandConstant('{param:SBTESTFAIL|}') = 'missing-component') then
    DeleteFile(CheckRoot + '\runtime\ffmpeg.exe');
  if not Exec(CheckRoot + '\runtime\node.exe', '"' + CheckRoot + '\native\self-check.js"',
    CheckRoot, SW_HIDE, ewWaitUntilTerminated, ExitCode) or (ExitCode <> 0) then
    RaiseException(CustomMessage('CheckFailed'));
  BundleChecked := True;
end;

procedure PrepareHelper;
var Manifest, Guide, AppPath: String; GuideUtf8: AnsiString;
begin
  AppPath := ExpandConstant('{app}');
  Manifest := '{"name":"com.sunobeast.audio","description":"Suno Beast audio helper","type":"stdio","path":"' +
    JsonPath(AppPath + '\native\launch-host.cmd') + '","allowed_origins":["chrome-extension://{#ExtensionId}/"]}';
  if not SaveStringToFile(ExpandConstant('{tmp}\com.sunobeast.audio.json'), UTF8Encode(Manifest), False) then RaiseException(CustomMessage('CheckFailed'));
  if not SaveStringToFile(ExpandConstant('{tmp}\installer-scope.txt'), ScopeId, False) then RaiseException(CustomMessage('CheckFailed'));
  Guide := 'Suno Beast' + #13#10 + #13#10 +
    'Node.js, FFmpeg and ffprobe are included. No additional downloads are needed.' + #13#10 + #13#10 +
    '1. Open your browser extensions page:' + #13#10 +
    '   Chrome: chrome://extensions' + #13#10 + '   Edge: edge://extensions' + #13#10 +
    '   Yandex: browser://extensions' + #13#10 + '   Opera / Opera GX: opera://extensions (experimental)' + #13#10 +
    '2. Enable Developer mode and choose Load unpacked.' + #13#10 +
    '3. Select this folder:' + #13#10 + AppPath + '\extension' + #13#10 +
    '4. Pin Suno Beast, open https://suno.com and click its toolbar button.' + #13#10 + #13#10 +
    'If Suno Beast was already connected, restart the browser to use the new helper.' + #13#10 +
    'Before updating or uninstalling, finish recording and close browsers using Suno Beast.' + #13#10 +
    'After updating, reopen the browser and reload Suno Beast on the extensions page.' + #13#10 +
    'Uninstalling preserves recordings, settings and the collection index.' + #13#10;
  if ActiveLanguage = 'russian' then
    Guide := 'Suno Beast — подключение расширения' + #13#10 + #13#10 +
      'Всё необходимое уже установлено. Отдельно устанавливать Node.js и FFmpeg не нужно.' + #13#10 + #13#10 +
      '1. Откройте страницу расширений в браузере:' + #13#10 +
      '   Chrome: chrome://extensions' + #13#10 + '   Edge: edge://extensions' + #13#10 +
      '   Яндекс: browser://extensions' + #13#10 + '   Opera / Opera GX: opera://extensions (экспериментально)' + #13#10 +
      '2. Включите «Режим разработчика» и нажмите «Загрузить распакованное расширение».' + #13#10 +
      '3. Выберите папку:' + #13#10 + AppPath + '\extension' + #13#10 +
      '4. Закрепите Suno Beast на панели браузера, откройте https://suno.com и нажмите его кнопку.' + #13#10 + #13#10 +
      'Если Suno Beast уже был подключён, перезапустите браузер для работы с новым помощником.' + #13#10 +
      'После обновления нажмите перезагрузку карточки Suno Beast на странице расширений.' + #13#10 +
      'Перед обновлением или удалением завершите запись и закройте браузеры с Suno Beast.' + #13#10 +
      'Удаление программы сохраняет записи, настройки и индекс коллекции.' + #13#10;
  GuideUtf8 := UTF8Encode(#$FEFF + Guide);
  if not SaveStringToFile(ExpandConstant('{tmp}\GettingStarted.txt'), GuideUtf8, False) then RaiseException(CustomMessage('CheckFailed'));
end;

function InitializeUninstall: Boolean;
var Saved: AnsiString;
begin
  Result := LoadStringFromFile(ExpandConstant('{app}\installer-scope.txt'), Saved);
  if Result then begin
    ScopeId := Trim(String(Saved));
    Result := ValidScope(ScopeId);
  end;
  if not Result then MsgBox('Cannot verify the installation scope. Uninstall was cancelled.', mbError, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var I: Integer; Current, Expected, Previous: String;
begin
  if CurUninstallStep = usUninstall then begin
    Expected := ExpandConstant('{app}\native\com.sunobeast.audio.json');
    BackupFile := ExpandConstant('{app}\registration-backup.ini');
    for I := 0 to 1 do begin
      if RegQueryStringValue(HKCU, HostKey(I), '', Current) and (CompareText(Current, Expected) = 0) then begin
        Previous := GetIniString(IntToStr(I), 'Path', '', BackupFile);
        if (GetIniString(IntToStr(I), 'HadValue', '0', BackupFile) = '1') and
          (CompareText(Previous, Expected) <> 0) and FileExists(Previous) then begin
          if not RegWriteStringValue(HKCU, HostKey(I), '', Previous) then begin
            SuppressibleMsgBox(CustomMessage('RegisterFailed'), mbError, MB_OK, IDOK);
            Abort;
          end;
        end else begin
          if not RegDeleteValue(HKCU, HostKey(I), '') then begin
            SuppressibleMsgBox(CustomMessage('RegisterFailed'), mbError, MB_OK, IDOK);
            Abort;
          end;
          RegDeleteKeyIfEmpty(HKCU, HostKey(I));
        end;
      end;
    end;
  end;
end;
