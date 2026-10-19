# Совместимость браузеров

Расширение использует Manifest V3, `chrome.tabCapture.getMediaStreamId`, `chrome.runtime.getContexts`, `chrome.offscreen.createDocument` и Native Messaging. Смена браузера не меняет ID расширения: он вычисляется из фиксированного ключа в `extension/manifest.json`. Проверка origin в помощнике остаётся обязательной.

## Текущий объём

| Браузер | Установка помощника | Проверка в браузере |
| --- | --- | --- |
| Chrome, Edge | Windows и macOS | Основные браузеры проекта; проверка macOS сообщена автором macOS-исправления |
| Opera, Opera GX | Используется регистрация Chrome | Экспериментально; полный прогон записи ещё не выполнен |
| Яндекс Браузер | Регистрация Chrome на Windows; отдельная регистрация на macOS | Экспериментально; на Windows проверены API, фоновый документ и связь с помощником, полный прогон записи ещё не выполнен |
| Firefox, Safari | Не реализована для Suno Beast | Отдельный будущий перенос; не включены в этот этап |

Локальные тесты API Chrome и установщика не подтверждают запись и доставку файлов в конкретном браузере. macOS-регистрация Яндекс Браузера также требует проверки на Mac.

## Регистрация

Windows: пользовательские ключи `HKCU:\Software\Google\Chrome` и `HKCU:\Software\Microsoft\Edge` с суффиксом `NativeMessagingHosts\com.sunobeast.audio`. Opera, Opera GX и Яндекс Браузер используют регистрацию Chrome. Путь ведёт к манифесту текущей копии проекта; существующая регистрация другой копии блокирует установку.

macOS: манифесты `com.sunobeast.audio.json` в `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`, `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts` и `~/Library/Application Support/Yandex/YandexBrowser/NativeMessagingHosts`. Opera и Opera GX используют регистрацию Chrome. Не добавляем произвольные каталоги профилей и wildcard origin.

На Windows `native/uninstall.ps1` удаляет только ключи, указывающие на манифест текущей копии. На macOS при ручном удалении регистрации сначала проверьте её `path`, чтобы не удалить регистрацию другой копии проекта.

## Выполненная проверка — 2026-10-19

Яндекс Браузер **26.8.5.811** (Chromium **150.0.7871.811**), Windows, отдельный временный профиль в headless-режиме:

- Пакет `extension/` загружен через DevTools Protocol, страница расширения открылась с ожидаемым ID.
- `tabCapture.getMediaStreamId`, `offscreen.createDocument`, `runtime.getContexts` и `runtime.connectNative` доступны.
- Создан и закрыт настоящий `OFFSCREEN_DOCUMENT` с причинами `USER_MEDIA` / `BLOBS`.
- Из расширения получен ответ `status` от настоящего `native/host.js` через временную Chrome-регистрацию с отдельным именем хоста и изолированным каталогом состояния.
- Отдельные тестовые ключи `Software\Yandex` и `Software\Yandex\YandexBrowser` дали `Specified native messaging host not found`; в установщике они не используются.

Эта проверка подтверждает загрузку, API и транспорт. Реальный захват трека Suno, автопереходы, системные диалоги и доставка загрузок в Яндекс Браузере ещё не проверены. Opera и Opera GX в этом прогоне не запускались.

## Проверка перед объявлением полной поддержки

Для каждого браузера и ОС отдельно:

1. Установить помощник и загрузить папку `extension` через режим разработчика. Убедиться, что расширение загрузилось и помощник подключается.
2. Открыть Suno, проверить панель, сведения о треке, RU/EN и доступ к сайту.
3. Записать ручной фрагмент, сохранить MP3 и WAV с реальным звуком.
4. Включить Auto-Grab до начала трека: два трека должны сохраниться целиком при автопереходе, третий прерванный трек не должен появиться в коллекции.
5. Проверить загрузки браузера, выбранную папку, отмену диалога, привязку существующего аудиофайла и открытие папки.
6. Проверить перезапуск браузера, сохранение настроек и защиту от дублей по ID Suno.

Если нужных API нет, запуск записи завершается до получения stream ID и обращения к помощнику с сообщением об обновлении браузера. Отсутствие API нельзя исправить одной регистрацией Native Messaging.

## Источники

- [Opera: Native Messaging](https://help.opera.com/en/extensions/message-passing/) — использует регистрацию Chrome. Документация Opera не заменяет проверку конкретной версии Opera / GX.
- [Яндекс: расширения](https://www.yandex.ru/support/browser/ru/personalization/extension) — расширения Chrome / Opera и страница `browser://extensions`.
- [AdGuard: поддерживаемые macOS-браузеры](https://github.com/AdguardTeam/CompatibilityIssues/blob/master/mac/browsers.json) — используемый проектом AdGuard путь `Yandex/YandexBrowser/NativeMessagingHosts` и Chrome-регистрация для Opera.
- [Chrome: захват аудио](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture) и [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen).
- [Safari: связь с нативным приложением](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension) — другой транспорт через приложение, содержащее расширение.
