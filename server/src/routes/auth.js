import { getSetting, setSetting } from '../db.js';
import { createAuthRouter } from './authRouter.js';

export default createAuthRouter({ getSetting, setSetting });
