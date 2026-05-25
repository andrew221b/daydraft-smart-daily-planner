import os

filepath = '/Users/andrew/Desktop/daydraft-smart-daily-planner-main/src/index.css'
with open(filepath, 'rb') as f:
    content = f.read()

# Reverse the replacements made by the previous script
# For the main pressable block
content = content.replace(b'''  .pressable:active {
    transform: scale(0.96) translateY(1px);
    filter: brightness(0.92);
    transition: transform 90ms cubic-bezier(0.25, 1, 0.5, 1), filter 90ms ease, box-shadow 90ms ease;
    transition-delay: 50ms;
  }''', b'''  .pressable[data-pressed="true"] {
    transform: scale(0.96) translateY(1px);
    filter: brightness(0.92);
    transition: transform 90ms cubic-bezier(0.25, 1, 0.5, 1), filter 90ms ease, box-shadow 90ms ease;
  }''')

content = content.replace(b'''    .pressable:active {
      transform: scale(0.96) translateY(1px) !important;
      filter: brightness(0.92) !important;
      transition-delay: 50ms;
    }''', b'''    .pressable[data-pressed="true"] {
      transform: scale(0.96) translateY(1px) !important;
      filter: brightness(0.92) !important;
    }''')

content = content.replace(b'''    .tappable:active {
      transform: scale(0.98) translateY(1px) !important;
      filter: brightness(0.96) !important;
      transition-delay: 50ms;
    }''', b'''    .tappable[data-pressed="true"] {
      transform: scale(0.98) translateY(1px) !important;
      filter: brightness(0.96) !important;
    }''')

content = content.replace(b'''  .tappable:active {
    transform: scale(0.98) translateY(1px);
    filter: brightness(0.96);
    transition: transform 90ms cubic-bezier(0.25, 1, 0.5, 1), filter 90ms ease;
    transition-delay: 50ms;
  }''', b'''  .tappable[data-pressed="true"] {
    transform: scale(0.98) translateY(1px);
    filter: brightness(0.96);
    transition: transform 90ms cubic-bezier(0.25, 1, 0.5, 1), filter 90ms ease;
  }''')

content = content.replace(b'''  .ios-row:active {
    background-color: hsl(var(--foreground) / 0.06);
    transition: background-color 0ms ease;
    transition-delay: 50ms;
  }
  :root.light .ios-row:active {
    background-color: hsl(var(--foreground) / 0.04);
    transition-delay: 50ms;
  }''', b'''  .ios-row[data-pressed="true"] {
    background-color: hsl(var(--foreground) / 0.06);
    transition: background-color 0ms ease;
  }
  :root.light .ios-row[data-pressed="true"] {
    background-color: hsl(var(--foreground) / 0.04);
  }''')

content = content.replace(b'''  .btn-volumetric.pressable:active {
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.2),
      0 2px 4px rgba(var(--primary-rgb), 0.15);
    transition-delay: 50ms;
  }''', b'''  .btn-volumetric.pressable[data-pressed="true"] {
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.2),
      0 2px 4px rgba(var(--primary-rgb), 0.15);
  }''')

# Also, there were a few more specific ones at the bottom of the file
content = content.replace(b'.pressable:active {', b'.pressable[data-pressed="true"] {')
content = content.replace(b'.tappable:active,', b'.tappable[data-pressed="true"],')
content = content.replace(b'.ios-row:active,', b'.ios-row[data-pressed="true"],')

with open(filepath, 'wb') as f:
    f.write(content)
