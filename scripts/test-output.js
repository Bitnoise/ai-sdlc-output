#!/usr/bin/env node

const startTime = Date.now();
const duration = 3 * 60 * 1000; // 3 minutes
let counter = 0;

const interval = setInterval(() => {
  counter++;
  const timestamp = new Date().toISOString();
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  console.log(`[${timestamp}] Output #${counter} (${elapsed}s elapsed)`);

  // Stop after 3 minutes
  if (Date.now() - startTime >= duration) {
    console.log(`\nScript completed after ${counter} outputs in 3 minutes`);
    clearInterval(interval);
    process.exit(0);
  }
}, 5000);

console.log('Test output script started. Will output every 5 seconds for 3 minutes...');
