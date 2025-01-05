import { Injectable } from '@angular/core';
import { createClient } from '@supabase/supabase-js';

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  SUPABASE_URL = 'https://xclibgfupaoxrwfxiotd.supabase.co';
  //RLS enabled so it is safe to expose supabase key
  SUPABASE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjbGliZ2Z1cGFveHJ3Znhpb3RkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzYwMzQzNzEsImV4cCI6MjA1MTYxMDM3MX0.YBEverrjBAM_emhYzVjd9Cyt2JpkZlqTUID2BYsO29Q';

  private supabase = createClient(this.SUPABASE_URL, this.SUPABASE_KEY);

  constructor() {}

  async loginWithGoogle() {
    const { data, error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      console.error('Google login error:', error.message);
    } else {
      console.log('Redirecting to Google for login...', data);
    }
  }

  async logout() {
    await this.supabase.auth.signOut();
  }

  async getSession() {
    return this.supabase.auth.getSession();
  }
}
