# 📱 DayDraft → Apple App Store handoff

Этот файл — пошаговая инструкция для **Cursor** (или любого другого агента/разработчика), как обернуть текущий веб-проект в нативный iOS-app для App Store через **Capacitor**.

Веб-приложение уже подготовлено по стандартам Apple HIG: safe-area, viewport-fit, no-zoom инпуты, system fonts (SF Pro), легальные страницы, удаление аккаунта. Осталось обернуть в нативный контейнер.

---

## ✅ Что уже сделано на стороне веб-проекта

- [x] **Viewport**: `viewport-fit=cover` + `maximum-scale=1.0` (нет автозума при тапе на инпут)
- [x] **Safe-area**: `env(safe-area-inset-*)` на body и нижнем таб-баре
- [x] **Шрифты**: `-apple-system / SF Pro Display / SF Pro Text` (системные, не CDN)
- [x] **Тач-поведение**: `-webkit-tap-highlight-color: transparent`, `overscroll-behavior-y: none`, `touch-action: manipulation`
- [x] **Apple meta**: `apple-mobile-web-app-capable`, `apple-touch-icon`, `theme-color`, статус-бар
- [x] **Иконка-исходник**: `public/icons/icon-1024.png` (1024×1024, без прозрачности — Apple требование)
- [x] **Манифест**: `public/manifest.json` (`display: standalone`, `start_url: /today`)
- [x] **Privacy Policy**: роут `/privacy` (компонент `src/pages/legal/Privacy.tsx`)
- [x] **Terms of Service**: роут `/terms` (`src/pages/legal/Terms.tsx`)
- [x] **Account deletion**: роут `/settings/delete-account` — обязательное требование Apple Guideline 5.1.1(v)
- [x] **Tap targets**: кнопки в таб-баре ≥ 44pt (h-10 + padding)
- [x] **Темы**: light + dark режимы через CSS-переменные

---

## 🚀 Шаги для Cursor: обернуть в нативный iOS-app

### 1. Установить Capacitor

```bash
npm install @capacitor/core @capacitor/ios
npm install -D @capacitor/cli
npx cap init "DayDraft" "app.daydraft.ios" --web-dir=dist
```

`appId` менять на свой реверс-домен (купи `daydraft.app` или используй `com.твой-домен.daydraft`).

### 2. `capacitor.config.ts` — рекомендуемая конфигурация

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.daydraft.ios',
  appName: 'DayDraft',
  webDir: 'dist',
  ios: {
    contentInset: 'always', // safe-area работает корректно
    backgroundColor: '#0a0a14',
    preferredContentMode: 'mobile',
  },
};

export default config;
```

⚠️ **НЕ добавлять** `server.url` для App Store сборки — иначе ревью отклонит (приложение должно работать офлайн с локальными ассетами).

### 3. Полезные плагины Capacitor

```bash
npm install @capacitor/status-bar @capacitor/splash-screen @capacitor/haptics @capacitor/keyboard @capacitor/app
```

- **status-bar**: настроить тёмную/светлую под тему приложения
- **splash-screen**: показывать `splash.png` пока грузится JS
- **haptics**: вибрация при тапах (iOS HIG рекомендует)
- **keyboard**: корректная работа клавиатуры с safe-area
- **app**: deep links и lifecycle события

Минимальная инициализация в `src/main.tsx`:

```ts
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  SplashScreen.hide({ fadeOutDuration: 300 }).catch(() => {});
}
```

### 4. Иконки и Splash

Используй `public/icons/icon-1024.png` как исходник.

```bash
npm install -D @capacitor/assets
npx capacitor-assets generate --ios
```

Это автоматически сгенерирует все нужные размеры иконок (20pt, 29pt, 40pt, 60pt @1x/@2x/@3x) и splash screens (Light/Dark, все устройства) в `ios/App/App/Assets.xcassets/`.

### 5. Сборка и открытие в Xcode

```bash
npm run build
npx cap add ios
npx cap sync ios
npx cap open ios
```

### 6. В Xcode — обязательные настройки

**General → Identity:**
- Display Name: `DayDraft`
- Bundle Identifier: `app.daydraft.ios` (тот же, что в `capacitor.config.ts`)
- Version: `1.0.0`, Build: `1`
- Deployment Target: **iOS 14.0+** (Capacitor 6 минимум)

**Signing & Capabilities:**
- Включи Automatic signing → выбрать твою Apple Developer Team
- Добавь capability: **Push Notifications** (если используешь нудж-уведомления)
- Добавь capability: **Background Modes → Remote notifications** (то же)
- Добавь capability: **Sign in with Apple** ⚠️ **ОБЯЗАТЕЛЬНО** если используешь Google OAuth (Guideline 4.8 — нужен и Apple Sign-In)

**Info.plist — добавь описания:**

```xml
<key>NSMicrophoneUsageDescription</key>
<string>DayDraft uses voice input so you can dictate tasks instead of typing.</string>

<key>NSCalendarsUsageDescription</key>
<string>DayDraft reads your calendar to schedule tasks around your meetings.</string>

<key>NSUserTrackingUsageDescription</key>
<string>DayDraft does not track you across apps. This permission is requested only if a future feature needs it.</string>

<!-- Если поддерживаешь только portrait -->
<key>UISupportedInterfaceOrientations</key>
<array>
  <string>UIInterfaceOrientationPortrait</string>
</array>
```

### 7. App Store Connect — что заполнить

| Поле | Значение |
|---|---|
| App Name | DayDraft |
| Subtitle (30 chars) | Design your perfect day |
| Category | Productivity |
| Privacy Policy URL | `https://daydraft.app/privacy` (после publish в Lovable) |
| Terms (EULA) URL | `https://daydraft.app/terms` (опционально, иначе Apple Standard EULA) |
| Support URL | `https://daydraft.app/settings` или `mailto:support@daydraft.app` |
| Account deletion | "In-app: Settings → Delete account" + ссылка на `/settings/delete-account` |
| Age Rating | 4+ (нет UGC) |

**App Privacy → Data Types** (заполни честно):
- ✅ Email Address — linked to user, app functionality
- ✅ User Content (tasks, plans) — linked to user, app functionality
- ✅ Diagnostics — not linked, analytics
- ❌ Location, Contacts, Photos, Tracking — НЕ собирается

### 8. Test Flight → Production

```bash
# В Xcode: Product → Archive → Distribute App → App Store Connect → Upload
```

Перед submit пройди **App Review Guidelines** checklist:
- [ ] **5.1.1(v)** Account Deletion — есть, маршрут `/settings/delete-account` ✅
- [ ] **3.1.1** In-App Purchase — если у тебя Pro подписка, **обязан** использовать Apple IAP, не Stripe
- [ ] **4.8** Sign in with Apple — добавить, если есть Google OAuth
- [ ] **2.1** App Completeness — нет плейсхолдеров, демо-данных, "Coming soon"
- [ ] **2.5.1** No private APIs — Capacitor не использует, ок
- [ ] **5.1.1** Privacy — есть Privacy Policy URL ✅

---

## 💳 Важно про подписки (Pro plan)

Сейчас в коде есть `useEntitlement` и Stripe-интеграция. Для App Store **придётся** заменить Stripe на **Apple In-App Purchase** через `@revenuecat/purchases-capacitor` (рекомендую RevenueCat — он сам синхронизирует Apple/Google/Stripe).

Apple берёт 15-30% комиссии с подписок — это правило, обойти нельзя.

---

## 📞 Контакты для замены

Замени в коде и в этом файле плейсхолдеры:
- `support@daydraft.app` → твой реальный support email
- `privacy@daydraft.app` → твой privacy email
- `legal@daydraft.app` → твой legal email
- `daydraft.app` → твой реальный домен

Эти адреса используются в:
- `src/pages/legal/Privacy.tsx`
- `src/pages/legal/Terms.tsx`
- `src/pages/legal/DeleteAccount.tsx`

---

## 🎨 Иконка приложения

`public/icons/icon-1024.png` — текущий исходник 1024×1024.
Если хочешь другую — замени файл, перезапусти `npx capacitor-assets generate --ios`.

**Apple требования к иконке:**
- 1024×1024 PNG, RGB, без альфа-канала, без прозрачности
- Без скруглённых углов (Apple маскирует сама)
- Без текста (или минимум)
- Узнаваемая в маленьком размере (40×40)

---

Готово. После выполнения шагов 1-8 приложение готово к ревью Apple. 🚀