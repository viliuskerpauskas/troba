import { Component, inject } from '@angular/core';
import { SupabaseService } from '../../services/supabase.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  imports: [],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  supabaseService = inject(SupabaseService);
  router = inject(Router);

  async logout() {
    await this.supabaseService.signOut();
    this.router.navigate(['']);
  }

  logSession() {
    const session = this.supabaseService.getSession();
    console.log('Session', session);
  }
}
