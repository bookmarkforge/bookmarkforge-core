import fs from 'fs';
import path from 'path';

const translations = {
  ar: { totalReferrals: 'إجمالي الإحالات', totalEarnings: 'إجمالي الأرباح', dashboard: 'لوحة التحكم' },
  bg: { totalReferrals: 'Общо реферали', totalEarnings: 'Общо приходи', dashboard: 'Табло' },
  cs: { totalReferrals: 'Celkem doporučení', totalEarnings: 'Celkem výdělky', dashboard: 'Panel' },
  da: { totalReferrals: 'Samlet henvisninger', totalEarnings: 'Samlet indtjening', dashboard: 'Dashboard' },
  de: { totalReferrals: 'Gesamt Empfehlungen', totalEarnings: 'Gesamtverdienst', dashboard: 'Dashboard' },
  el: { totalReferrals: 'Συνολικές προτάσεις', totalEarnings: 'Συνολικά κέρδη', dashboard: 'Πίνακας' },
  fi: { totalReferrals: 'Suositu suositukset', totalEarnings: 'Kokonaisansiot', dashboard: 'Hallintapaneeli' },
  fr: { totalReferrals: 'Total des parrainages', totalEarnings: 'Gains totaux', dashboard: 'Tableau de bord' },
  he: { totalReferrals: 'סהכ הפניות', totalEarnings: 'הכנסות כולל', dashboard: 'לוח בקרה' },
  hi: { totalReferrals: 'कुल रेफरल', totalEarnings: 'कुल कमाई', dashboard: 'डैशबोर्ड' },
  hr: { totalReferrals: 'Ukupno preporuka', totalEarnings: 'Ukupno zarada', dashboard: 'Upravljačka ploča' },
  hu: { totalReferrals: 'Összes ajánlás', totalEarnings: 'Összes bevétel', dashboard: 'Vezérlőpult' },
  id: { totalReferrals: 'Total rujukan', totalEarnings: 'Total pendapatan', dashboard: 'Dasbor' },
  it: { totalReferrals: 'Totale raccomandazioni', totalEarnings: 'Guadagni totali', dashboard: 'Dashboard' },
  ja: { totalReferrals: '総紹介数', totalEarnings: '総収益', dashboard: 'ダッシュボード' },
  ko: { totalReferrals: '총 추천', totalEarnings: '총 수익', dashboard: '대시보드' },
  nl: { totalReferrals: 'Totaal doorverwijzingen', totalEarnings: 'Totaal verdiensten', dashboard: 'Dashboard' },
  no: { totalReferrals: 'Total henvisninger', totalEarnings: 'Total inntjening', dashboard: 'Kontrollpanel' },
  pl: { totalReferrals: 'Łącznie poleceń', totalEarnings: 'Łączne zarobki', dashboard: 'Panel sterowniczy' },
  pt: { totalReferrals: 'Total de indicações', totalEarnings: 'Ganhos totais', dashboard: 'Painel de controle' },
  ro: { totalReferrals: 'Total recomandări', totalEarnings: 'Câștiguri totale', dashboard: 'Panou de control' },
  ru: { totalReferrals: 'Всего рефералов', totalEarnings: 'Всего заработок', dashboard: 'Панель управления' },
  sv: { totalReferrals: 'Totalt hänvisningar', totalEarnings: 'Totalt intäkter', dashboard: 'Översikt' },
  th: { totalReferrals: 'การแนะนำรวม', totalEarnings: 'รายได้รวม', dashboard: 'แดชบอร์ด' },
  tr: { totalReferrals: 'Toplam yönlendirme', totalEarnings: 'Toplam kazanç', dashboard: 'Kontrol paneli' },
  uk: { totalReferrals: 'Загалом рефералів', totalEarnings: 'Загальний заробіток', dashboard: 'Панель керування' },
  vi: { totalReferrals: 'Tổng giới thiệu', totalEarnings: 'Tổng thu nhập', dashboard: 'Bảng điều khiển' },
  zh: { totalReferrals: '总推荐数', totalEarnings: '总收入', dashboard: '仪表板' }
};

const localesDir = path.join(process.cwd(), 'public', 'locales');

Object.keys(translations).forEach(lang => {
  const filePath = path.join(localesDir, `${lang}.json`);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.app_proAffiliateTotalReferrals = translations[lang].totalReferrals;
    data.app_proAffiliateTotalEarnings = translations[lang].totalEarnings;
    data.app_proAffiliateDashboard = translations[lang].dashboard;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Added affiliate stats translations to ${lang}`);
  }
});

console.log('Done!');
