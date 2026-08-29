import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les tests e2e partagent une seule base Mongo physique (yugioh_dnd_test,
    // voir package.json) et chaque fichier fait un dropDatabase() dans son
    // afterAll : en parallèle, le drop d'un fichier percute les requêtes
    // encore en vol d'un autre ("The database is currently being dropped").
    // Fichiers en série : plus lent, mais plus de résultat par hasard.
    fileParallelism: false,
  },
});
