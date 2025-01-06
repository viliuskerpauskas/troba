import { Component, inject, OnInit } from '@angular/core';
import { SupabaseService } from '../../services/supabase.service';
import { ActivatedRoute, Router } from '@angular/router';
import { User } from '@supabase/supabase-js';

@Component({
  selector: 'app-dashboard',
  imports: [],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  router = inject(Router);
  route = inject(ActivatedRoute);

  user?: User;

  async ngOnInit() {
    const session = await this.supabaseService.getSession();
    this.user = session.data.session?.user;
  }

  async logout() {
    await this.supabaseService.signOut();
    this.router.navigate(['']);
  }

  async logSession() {
    const session = await this.supabaseService.getSession();

    console.log('Session', session.data.session);
    console.log('Route', this.route);
    console.log('User', this.user);
  }
}
