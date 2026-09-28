import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Placeholder for `/` until the workspace overview lands; proves routing, zoneless rendering, daisyUI and i18n. */
@Component({
  selector: 'app-hello',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="p-8">
      <section class="card card-border max-w-md">
        <div class="card-body">
          <h1 class="card-title">{{ 'common.appName' | transloco }}</h1>
          <p><span class="badge">{{ 'hello.greeting' | transloco }}</span></p>
        </div>
      </section>
    </main>
  `,
})
export class HelloComponent {}
