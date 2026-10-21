// Configuração do Supabase. Estes dois valores são públicos por natureza
// (a segurança vem do login + Row Level Security), então podem ir para o Git.
// Supabase → Project Settings → API (ou "Connect"):
//   url     = Project URL         (ex.: https://abcdefgh.supabase.co)
//   anonKey = chave anon/public  (ou a "publishable key", sb_publishable_...)
// NUNCA coloque aqui a service_role / secret key.
// Deixe vazio para salvar só no navegador (ou no server.js local).
window.SUPABASE_CONFIG = {
  url: 'https://hsaguhwscevwaguspuem.supabase.co',
  anonKey: 'sb_publishable_SbJPnDy3gN5jGBzFvRxbzQ_tPoh4vbk',
};
