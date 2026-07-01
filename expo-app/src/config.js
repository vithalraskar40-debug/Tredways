import { Platform } from 'react-native';

// Centralized API URL for mobile/web builds.
// Edit the DEFAULT_MOBILE value to match your machine IP before building the APK.
const DEFAULT_MOBILE = 'http://192.168.1.6:8000';

export const API_URL = Platform.OS === 'web' ? 'http://localhost:3000' : (global.__TRENDWAY_API_URL__ || DEFAULT_MOBILE);

export const IMAGE_BASE_URL = `${API_URL}/uploads/`;
export default { API_URL, IMAGE_BASE_URL };
