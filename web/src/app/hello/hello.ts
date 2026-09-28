import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Placeholder for `/` until the workspace overview lands; proves routing, zoneless rendering and daisyUI. */
@Component({
  selector: 'app-hello',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="p-8">
      <section class="card card-border max-w-md">
        <div class="card-body">
          <h1 class="card-title">Spectant</h1>
          <p><span class="badge">hello, spectant</span></p>
        </div>
      </section>
    </main>
  `,
})
export class HelloComponent {}
