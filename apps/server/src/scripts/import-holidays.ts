const year = process.argv[2] ?? String(new Date().getFullYear());
const { importHolidayYear } = await import('../services/holidays.js');
const result = importHolidayYear(Number(year));
console.log(`Imported ${result.count} calendar overrides for ${result.year}.`);
