import { Component, inject, OnInit } from '@angular/core';
import { SupabaseService } from '../../services/supabase.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-login',
  imports: [],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  router = inject(Router);
  constructor() {}

  async ngOnInit() {
    const { data, error } = await this.supabaseService.getSession();

    if (error) {
      console.error('Error handling Google login redirect:', error.message);
    } else if (data.session) {
      console.log('User logged in via Google:', data.session.user);
      this.router.navigate(['/dashboard']);
    }
  }

  async loginWithGoogle() {
    this.supabaseService.loginWithGoogle();
  }
}
