const fs = require('fs');
const content = fs.readFileSync('src/pages/app/DayView.tsx', 'utf8');

const updated = content.replace(
  /    return \(\) => clearTimeout\(timer\);\n\n    \/\/ One-time cleanup/,
  `    // One-time cleanup`
).replace(
  /      syncBlockNotifications\(viewDate, taskRows\);\n    }\n  }, \[dayData, viewDate, plan\?\.id, isPast, isPlaceholderData, setLoadedBlocksDate\]\);/,
  `      syncBlockNotifications(viewDate, taskRows);\n    }\n\n    return () => clearTimeout(timer);\n  }, [dayData, viewDate, plan?.id, isPast, isPlaceholderData, setLoadedBlocksDate]);`
);

fs.writeFileSync('src/pages/app/DayView.tsx', updated);
