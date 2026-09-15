import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';
import 'material-symbols/outlined.css';
import './styles/index.css';
import './styles/breeze.css';
import Screens from './screens/Screens';
import { ThemeProvider } from './contexts/ThemeContext';
import { initPermissionsMiddleware } from './requests/permissions-middleware';

// Register the permissions-update middleware before the React tree mounts so that
// any API call made during initialisation is also covered.
initPermissionsMiddleware();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <Screens />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
