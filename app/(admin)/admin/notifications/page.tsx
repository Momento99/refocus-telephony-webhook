import { redirect } from 'next/navigation';

// Раздел переехал в «Мобильное приложение» (вкладка «Уведомления»).
export default function NotificationsRedirect() {
  redirect('/admin/mobile-app');
}
