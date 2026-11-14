import { getSetting, setSetting } from '../db.js';
import { createTotpRouter } from './totpRouter.js';

export default createTotpRouter({ getSetting, setSetting });
