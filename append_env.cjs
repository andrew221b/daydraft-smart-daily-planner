const fs = require('fs');
let code = fs.readFileSync('.env', 'utf8');

if (!code.includes('VITE_RC_IOS_KEY')) {
  code += '\n\n# RevenueCat Keys\nVITE_RC_IOS_KEY="appl_YOUR_IOS_KEY_HERE"\nVITE_RC_ANDROID_KEY="goog_YOUR_ANDROID_KEY_HERE"\nVITE_RC_ENTITLEMENT="pro"\n';
  fs.writeFileSync('.env', code);
}
