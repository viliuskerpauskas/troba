import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);
  const session = await supabaseService.getSession();
  if (session.data.session) {
    console.log('LOGGED IN');
    return true;
  } else {
    console.log('NOT LOGGED IN');
    router.navigate(['/login']);
    return false;
  }
};
