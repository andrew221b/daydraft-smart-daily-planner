import os

filepath = '/Users/andrew/Desktop/daydraft-smart-daily-planner-main/src/index.css'
with open(filepath, 'rb') as f:
    content = f.read()

# Replace the specific blocks manually
content = content.replace(b'[data-pressed="true"]', b':active')

# Add transition-delay: 50ms to the main pressable block
content = content.replace(b'''  .pressable:active {
    transform: scale(0.96) translateY(1px);
    filter: brightness(0.92);
    transition: transform 90ms cubic-bezier(0.25, 1, 0.5, 1), filter 90ms ease, box-shadow 90ms ease;
  }''', b'''  .pressable:active {
    transform: scale(0.96) translateY(1px);
    filter: brightness(0.92);
    transition: transform 90ms cubic-bezier(0.25, 1, 0.5, 1), filter 90ms ease, box-shadow 90ms ease;
    transition-delay: 50ms;
  }''')

content = content.replace(b'''    .pressable:active {
      transform: scale(0.96) translateY(1px) !important;
      filter: brightness(0.92) !important;
    }''', b'''    .pressable:active {
      transform: scale(0.96) translateY(1px) !important;
      filter: brightness(0.92) !important;
      transition-delay: 50ms;
    }''')

content = content.replace(b'''    .tappable:active {
      transform: scale(0.98) translateY(1px) !important;
      filter: brightness(0.96) !important;
    }''', b'''    .tappable:active {
      transform: scale(0.98) translateY(1px) !important;
      filter: brightness(0.96) !important;
      transition-delay: 50ms;
    }''')

content = content.replace(b'''  .tappable:active {
    transform: scale(0.98) translateY(1px);
    filter: brightness(0.96);
    transition: transform 90ms cubic-bezier(0.25, 1, 0.5, 1), filter 90ms ease;
  }''', b'''  .tappable:active {
    transform: scale(0.98) translateY(1px);
    filter: brightness(0.96);
    transition: transform 90ms cubic-bezier(0.25, 1, 0.5, 1), filter 90ms ease;
    transition-delay: 50ms;
  }''')

content = content.replace(b'''  .ios-row:active {
    background-color: hsl(var(--foreground) / 0.06);
    transition: background-color 0ms ease;
  }
  :root.light .ios-row:active {
    background-color: hsl(var(--foreground) / 0.04);
  }''', b'''  .ios-row:active {
    background-color: hsl(var(--foreground) / 0.06);
    transition: background-color 0ms ease;
    transition-delay: 50ms;
  }
  :root.light .ios-row:active {
    background-color: hsl(var(--foreground) / 0.04);
    transition-delay: 50ms;
  }''')

content = content.replace(b'''  .btn-volumetric.pressable:active {
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.2),
      0 2px 4px rgba(var(--primary-rgb), 0.15);
  }''', b'''  .btn-volumetric.pressable:active {
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.2),
      0 2px 4px rgba(var(--primary-rgb), 0.15);
    transition-delay: 50ms;
  }''')

with open(filepath, 'wb') as f:
    f.write(content)
