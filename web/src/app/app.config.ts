import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Explicit on purpose: zoneless is the default in Angular 22, but the intent must not hang on a default.
    provideZonelessChangeDetection(),
    provideRouter(routes),
  ],
};
