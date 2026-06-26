# Промпт для Claude Code / Cursor — интеграция time dataset в DayDraft

Вставь это сообщение в свой проект в Claude Code или Cursor:

---

## Задача

Я разрабатываю Flutter-приложение DayDraft — AI-powered трекер времени на Gemini Flash.

У меня есть JSON файл `time_data_compact.json` с 490 активностями и задачами по 22 профессиям, каждая со средним временем выполнения в минутах (данные из ATUS 2024 и O*NET).

Структура файла:
```json
{
  "Design": [
    {
      "occupation": "UI/UX Designer",
      "tasks": [
        {"task": "Wireframing & prototyping", "min": 120},
        {"task": "Visual design (mockups, assets)", "min": 120}
      ]
    }
  ],
  "Tech & IT": [...]
}
```

## Формат отображения времени в приложении

- До 60 минут → показывать как число + "min" (например: "45 min")
- От 60 минут и выше → показывать как HH:MM (например: "1:30", "2:00")

Gemini должен всегда возвращать время с учётом этого формата.

## Что нужно реализовать

Реализуй категориальный lookup для AI time suggestions в два шага:

### Шаг 1 — Определение категории

Когда пользователь добавляет задачу, делай первый запрос к Gemini Flash:

**System prompt:**
```
You are a task categorizer. Given a task name, return ONLY a JSON object with one field "category" matching one of these exact values:
"Personal Care", "Household Activities", "Caring for HH Members", "Caring for Non-HH Members",
"Work", "Education", "Consumer Purchases", "Professional Services", "Household Services",
"Government & Civic", "Eating & Drinking", "Socializing & Leisure", "Sports & Exercise",
"Religious Activities", "Volunteering", "Telephone & Communication", "Traveling",
"Tech & IT", "Design", "Creative", "Marketing", "Sales", "Management", "Finance",
"HR", "Healthcare", "Legal", "Customer Service", "Fitness & Sports",
"Food & Hospitality", "Freelance", "Personal", "Other"

Return ONLY valid JSON, no markdown, no explanation.
```

**User prompt:** `Categorize this task: "{task_name}"`

### Шаг 2 — Предложение времени

После получения категории — загрузи нужный блок из `time_data_compact.json` и делай второй запрос:

**System prompt:**
```
You are a time estimation assistant for a time tracking app.
Based on the reference data below showing average time people spend on similar activities,
suggest a realistic duration for the user's task.

Reference data for category "{category}":
{json_block}

Rules:
- Return ONLY a JSON object with exactly these fields:
  {
    "suggested_minutes": <integer>,
    "display": "<formatted string>",
    "reason": "<short explanation in same language as task>"
  }
- "suggested_minutes" is always a raw integer (total minutes)
- "display" formatting rules:
    - if suggested_minutes < 60 → display = "{suggested_minutes} min"  (example: "45 min")
    - if suggested_minutes >= 60 → display = "H:MM"  (example: "1:30", "2:00", "0:45" is NOT valid for < 60)
- Adjust based on task description context:
    - words like "quick", "briefly", "5 min" → suggest less than average
    - words like "deep work", "full session", "all day" → suggest more than average
- reason should be 1 short sentence, match the language the user wrote the task in
- No markdown, no extra text, no explanation outside the JSON
```

**User prompt:** `Task: "{task_name}". Suggest duration.`

### Шаг 3 — Отображение в UI

```dart
// Вспомогательная функция форматирования (на случай если Gemini вернул только suggested_minutes)
String formatDuration(int minutes) {
  if (minutes < 60) {
    return '$minutes min';
  } else {
    final h = minutes ~/ 60;
    final m = minutes % 60;
    return '$h:${m.toString().padLeft(2, '0')}';
  }
}
```

- Показывай `display` как pre-filled значение в поле длительности
- Показывай `reason` как subtitle/hint под полем (серый текст)
- Пользователь может изменить значение вручную
- Сохраняй реальное время пользователя — со временем это станет персональным контекстом

### Шаг 4 — Файл данных

Положи `time_data_compact.json` в папку `assets/data/` и добавь в `pubspec.yaml`:
```yaml
flutter:
  assets:
    - assets/data/time_data_compact.json
```

Загружай файл один раз при старте приложения и держи в памяти как `Map<String, dynamic>`.

### Fallback логика

```dart
// Если категория не найдена в JSON → используй "Other"
// Если Gemini вернул невалидный JSON → показывай поле пустым, не крашь приложение
// Если suggested_minutes == 0 или null → не показывай suggestion
```

### Кеширование

Кешируй результаты по названию задачи — если пользователь вводит одно и то же название повторно, не делай новый запрос к Gemini, возвращай кешированный результат. Используй простой `Map<String, SuggestedTime>` в памяти.

