// Prints a compact gazetteer for build.py: GeoNames places with at least 15,000 people
// (via the all-the-cities package). n = names joined by '|', c = [lat*100, lon*100, ...].
const cities = require('all-the-cities').filter(c => c.population >= 15000);
process.stdout.write(JSON.stringify({
  n: cities.map(c => c.name.replace(/\|/g, ' ')).join('|'),
  c: cities.flatMap(c => [Math.round(c.loc.coordinates[1] * 100), Math.round(c.loc.coordinates[0] * 100)])
}));
