# Переделка: ручной планер + AI-помощник + новая вкладка Reports

## 1. ИИ больше не строит план

**Удаляю автогенерацию:**
- Кнопка "Design my day" / "Generate plan" — убрана везде (Today, Planning, Home).
- `ClarifySheet` (превью + утверждение AI-плана) — удалён.
- `PlanDriftNudge` (AI «перестроить день») — удалён.
- `Planning.tsx` страница (raw input → AI) — удалена, маршрут `/today/planning` редиректит на `/today`.
- Edge function `generate-plan` — оставляю файл (для обратной совместимости с историей), но клиент её больше не вызывает. Убираю все импорты.
- Recap / RecapWeek / TodayInsight / yesterday-debrief / plan-drift / suggest-estimates — снимаю с UI (страницы остаются недоступны через навигацию). Маршруты `/recap*` редиректят на `/reports`.

**Что остаётся от AI (помощник, не строитель):**
- **AskAI чат-кнопка** в углу страницы Plan — открывает Sheet с чатом. Использует Lovable AI (`google/gemini-2.5-flash`). Может: посоветовать порядок, оценить время задачи, разбить большую задачу на шаги, предложить перерывы. Никогда не вставляет блоки сама — отвечает текстом, юзер копирует/решает.
- **Inline-помощь на блоке**: при тэпе на «…» в карточке блока — пункт «Ask AI about this» (оценить длительность / разбить на подзадачи, ответ показывается в том же sheet, юзер сам применяет).
- Новый edge function `ai-assist` принимает `{ mode: 'chat' | 'estimate' | 'split', messages?, block? }` и стримит/возвращает текст. Замена для всех старых AI-функций в UI.

## 2. Plan теперь полностью ручной

Страница `/today/plan` (DayView) становится главным «планером»:
- При открытии — если плана на сегодня нет, создаём пустой `plan` row (без AI).
- Список блоков (как сейчас) + крупная кнопка **«+ Add block»**: bottom sheet с полями Time, Duration, Title, Category, Type (task / break / meeting). Сохраняет напрямую в `blocks`.
- Drag & drop сортировка остаётся (`SortableBlock`).
- Тэп на время в карточке — меняет start_time (как сейчас).
- Свайп — удалить / completed.
- Удалить упоминания "AI rebuilt", reasoning плашки, ai_reasoning поле в UI (поле в БД остаётся, просто не показываем).
- `Today.tsx` (overview без блоков) сводится к одному короткому summary и редиректит на `/today/plan`. Маршрут `/today` показывает сразу DayView.

## 3. Навигация — 4 таба

`TabBar.tsx`:
```
Track (Timer)  |  Plan (CalendarDays)  |  Reports (BarChart3)  |  Settings (Settings)
```
- Track = `/home` (HomeTrackerHero без plan-companion и без today-categories — переезжают в Reports/Plan).
- Plan = `/today` → редирект на `/today/plan` (DayView).
- Reports = `/reports` (новая страница).
- Settings = `/settings`.

`activeTabIndex` обновляется. Удаляю History tab references (route остаётся как редирект на `/reports`).

## 4. Reports — новая страница

Чисто, минимализм, без перегруза. Вертикальная структура:

1. **Period switcher** (segmented): Day · Week · Month. Над всем.
2. **Total time** — крупная цифра (например, «4h 32m tracked this week») + сравнение с предыдущим периодом маленькой строчкой.
3. **By category** — горизонтальный stacked bar (полная ширина) + список под ним: цветной dot, название, время, процент. Никаких pie-чартов и легенд — только bar + список.
4. **Trend** (только для Week/Month) — простой line/area chart (recharts) часов в день за период.
5. **History** — последние 20 записей трекера (время, категория, длительность). Кнопка "Show all" → открывает Sheet с полным списком + правка/удаление (переиспользую логику из старого `History.tsx`).
6. **Export** внизу: две кнопки — **Download PDF** и **Download CSV** для текущего выбранного периода.
   - CSV: jsPDF не нужен, генерим строкой и скачиваем blob.
   - PDF: `jspdf` + `jspdf-autotable` (уже популярные). Структура: заголовок (период), total, таблица by-category, таблица записей.

Все цифры берутся из `time_entries` напрямую (через TanStack Query). Категории — из `time_categories`. Никаких новых таблиц.

## 5. Удаляемые/устаревающие компоненты

- `src/components/app/ClarifySheet.tsx`
- `src/components/app/PlanDriftNudge.tsx`
- `src/components/app/PreflightSheet.tsx` (часть AI-флоу)
- `src/components/app/SpilloverChips.tsx` (AI-rebuild)
- `src/components/app/TodayInsight.tsx`
- `src/components/app/NextUpCard.tsx` (если только AI)
- `src/pages/app/Planning.tsx`
- `src/pages/app/Recap.tsx`, `RecapWeek.tsx`
- `src/pages/app/History.tsx` (логика переезжает в Reports)
- Удаляю `useEntitlement` Pro-checks для AI features (AI чат тоже бесплатный — лёгкий, не агрессивный).

## 6. БД — без изменений схемы

Существующие таблицы `plans`, `blocks`, `time_entries`, `time_categories` полностью покрывают новый флоу. Никаких миграций.

## 7. Технические детали

- Новый edge function `ai-assist` — заменяет 5+ старых AI-функций. Один вход, три режима. Использует `LOVABLE_API_KEY`.
- React Router: добавить `/reports`, обновить редиректы для `/recap`, `/recap/week`, `/history`, `/today/planning`.
- Tabs: 4 в `TabBar.tsx`, индикатор шириной = (100% - 3*gap) / 4.
- `Home.tsx` упрощается: только HomeTrackerHero + минимальный Today summary (часы трекинга сегодня по категориям, как сейчас, но без plan-companion).
- TS типы: убираю поля связанные с AI из intermediate types в lib/daydraft, оставляю в БД-типах.

## Что попадёт в коммит (файлы)

**Новое:** `src/pages/app/Reports.tsx`, `src/components/app/AskAiSheet.tsx`, `src/components/app/AddBlockSheet.tsx`, `supabase/functions/ai-assist/index.ts`, `src/lib/reportExport.ts`.

**Изменено:** `App.tsx`, `TabBar.tsx`, `Home.tsx`, `Today.tsx`, `DayView.tsx`, `SortableBlock.tsx`, `Settings.tsx`, `Shell.tsx`.

**Удалено:** `Planning.tsx`, `Recap.tsx`, `RecapWeek.tsx`, `History.tsx`, `ClarifySheet.tsx`, `PlanDriftNudge.tsx`, `TodayInsight.tsx`, `PreflightSheet.tsx`, `SpilloverChips.tsx`, `NextUpCard.tsx`.

## Объём
~15 файлов изменить, ~10 удалить, ~5 создать, 1 новая edge-функция. Большой рефакторинг, но без миграций и без потери данных.
