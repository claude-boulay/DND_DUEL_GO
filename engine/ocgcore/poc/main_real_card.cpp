// Extension du POC : charge les VRAIS scripts globaux (constant.lua,
// utility.lua) et le VRAI script officiel de Raigeki (c12580477.lua, Project
// Ignis) pour vérifier qu'ils s'exécutent sans erreur contre le moteur
// compilé ici — pas seulement des cartes vanille sans script. Une carte
// "Monstre Test" (vanille, aucun script requis) est posée directement sur le
// terrain adverse comme cible potentielle pour Raigeki.
//
// Objectif : si aucune erreur Lua ne remonte via logHandler pendant le
// chargement + l'enregistrement initial_effect, et que le moteur atteint
// normalement un état d'attente de réponse joueur, c'est une preuve concrète
// que les scripts Project Ignis réels sont compatibles avec ce build.

#include <cstdio>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

#include "ocgapi.h"
#include "ocgapi_constants.h"

namespace {

constexpr uint32_t RAIGEKI_CODE = 12580477;
constexpr uint32_t TEST_MONSTER_CODE = 900001;

std::string ReadFile(const char* path) {
  std::ifstream f(path, std::ios::binary);
  std::ostringstream ss;
  ss << f.rdbuf();
  return ss.str();
}

const char* MessageName(uint8_t type) {
  switch (type) {
    case MSG_RETRY: return "RETRY";
    case MSG_HINT: return "HINT";
    case MSG_START: return "START";
    case MSG_SELECT_BATTLECMD: return "SELECT_BATTLECMD";
    case MSG_SELECT_IDLECMD: return "SELECT_IDLECMD";
    case MSG_SELECT_EFFECTYN: return "SELECT_EFFECTYN";
    case MSG_SELECT_YESNO: return "SELECT_YESNO";
    case MSG_SELECT_CARD: return "SELECT_CARD";
    case MSG_SELECT_CHAIN: return "SELECT_CHAIN";
    case MSG_SHUFFLE_DECK: return "SHUFFLE_DECK";
    case MSG_NEW_TURN: return "NEW_TURN";
    case MSG_NEW_PHASE: return "NEW_PHASE";
    case MSG_MOVE: return "MOVE";
    case MSG_SUMMONING: return "SUMMONING";
    case MSG_SUMMONED: return "SUMMONED";
    case MSG_CHAINING: return "CHAINING";
    case MSG_CHAINED: return "CHAINED";
    case MSG_CHAIN_SOLVING: return "CHAIN_SOLVING";
    case MSG_CHAIN_SOLVED: return "CHAIN_SOLVED";
    case MSG_CHAIN_END: return "CHAIN_END";
    case MSG_DRAW: return "DRAW";
    case MSG_DAMAGE: return "DAMAGE";
    case MSG_LPUPDATE: return "LPUPDATE";
    default: return "?";
  }
}

void PrintMessages(const uint8_t* buf, uint32_t length, bool hexDump) {
  uint32_t offset = 0;
  while (offset + 4 <= length) {
    uint32_t msg_len;
    std::memcpy(&msg_len, buf + offset, sizeof(msg_len));
    offset += 4;
    if (offset + msg_len > length || msg_len == 0) break;
    uint8_t msg_type = buf[offset];
    std::printf("  message type=%3u (%-16s) taille=%u\n", msg_type, MessageName(msg_type), msg_len);
    if (hexDump) {
      std::printf("   hex:");
      for (uint32_t i = 0; i < msg_len; ++i) std::printf(" %02x", buf[offset + i]);
      std::printf("\n");
    }
    offset += msg_len;
  }
}

void CardReader(void* /*payload*/, uint32_t code, OCG_CardData* data) {
  std::memset(data, 0, sizeof(OCG_CardData));
  data->code = code;
  static const uint16_t empty_setcodes[] = {0};
  data->setcodes = const_cast<uint16_t*>(empty_setcodes);
  if (code == RAIGEKI_CODE) {
    data->type = TYPE_SPELL | TYPE_NORMAL;
  } else if (code == TEST_MONSTER_CODE) {
    data->type = TYPE_MONSTER | TYPE_NORMAL;
    data->level = 4;
    data->attribute = ATTRIBUTE_EARTH;
    data->race = RACE_WARRIOR;
    data->attack = 1000;
    data->defense = 1000;
  } else {
    // cartes de remplissage du deck : monstres vanille génériques.
    data->type = TYPE_MONSTER | TYPE_NORMAL;
    data->level = 4;
    data->attribute = ATTRIBUTE_EARTH;
    data->race = RACE_WARRIOR;
    data->attack = 1000;
    data->defense = 1000;
  }
}

void CardReaderDone(void* /*payload*/, OCG_CardData* /*data*/) {}

std::string g_raigeki_script;

int ScriptReader(void* /*payload*/, OCG_Duel duel, const char* name) {
  std::printf("[scriptReader] demande : %s\n", name);
  // Nos cartes de test/remplissage sont vanille : rien à fournir ici, sauf
  // si le moteur redemande explicitement le script de Raigeki (normalement
  // déjà préchargé avant OCG_DuelNewCard, donc ce cas ne devrait pas arriver).
  if (std::strcmp(name, "c12580477.lua") == 0 && !g_raigeki_script.empty()) {
    return OCG_LoadScript(duel, g_raigeki_script.data(), static_cast<uint32_t>(g_raigeki_script.size()), name);
  }
  return 0;
}

void LogHandler(void* /*payload*/, const char* string, int type) {
  const char* type_name = type == OCG_LOG_TYPE_ERROR ? "ERREUR" : type == OCG_LOG_TYPE_FROM_SCRIPT ? "SCRIPT" : "DEBUG";
  std::printf("[core log %s] %s\n", type_name, string);
}

}  // namespace

int main() {
  int major = 0, minor = 0;
  OCG_GetVersion(&major, &minor);
  std::printf("ocgcore version %d.%d\n", major, minor);
  std::printf("Raigeki code=%u (hex=0x%08x)\n", RAIGEKI_CODE, RAIGEKI_CODE);

  std::string constant_lua = ReadFile("scripts/constant.lua");
  std::string utility_lua = ReadFile("scripts/utility.lua");
  g_raigeki_script = ReadFile("scripts/c12580477.lua");
  std::printf("constant.lua: %zu octets, utility.lua: %zu octets, c12580477.lua: %zu octets\n", constant_lua.size(),
              utility_lua.size(), g_raigeki_script.size());
  if (constant_lua.empty() || utility_lua.empty() || g_raigeki_script.empty()) {
    std::fprintf(stderr, "Échec de lecture d'un des scripts, arrêt.\n");
    return 1;
  }

  OCG_DuelOptions options{};
  options.seed[0] = 0x1;
  options.seed[1] = 0x2;
  options.seed[2] = 0x3;
  options.seed[3] = 0x4;
  options.flags = DUEL_MODE_MR5;
  options.team1 = OCG_Player{8000, 5, 1};
  options.team2 = OCG_Player{8000, 5, 1};
  options.cardReader = CardReader;
  options.payload1 = nullptr;
  options.scriptReader = ScriptReader;
  options.payload2 = nullptr;
  options.logHandler = LogHandler;
  options.payload3 = nullptr;
  options.cardReaderDone = CardReaderDone;
  options.payload4 = nullptr;
  options.enableUnsafeLibraries = 0;

  OCG_Duel duel = nullptr;
  int status = OCG_CreateDuel(&duel, &options);
  std::printf("OCG_CreateDuel -> %d (0 = succès)\n", status);
  if (status != 0) return 1;

  // Scripts globaux, à charger explicitement avant toute carte (README
  // ygopro-core : "Generally you do not call this directly except to load
  // global scripts").
  int r1 = OCG_LoadScript(duel, constant_lua.data(), static_cast<uint32_t>(constant_lua.size()), "constant.lua");
  int r2 = OCG_LoadScript(duel, utility_lua.data(), static_cast<uint32_t>(utility_lua.size()), "utility.lua");
  std::printf("OCG_LoadScript constant.lua -> %d, utility.lua -> %d (positif = succès)\n", r1, r2);
  if (r1 <= 0 || r2 <= 0) {
    std::fprintf(stderr, "Échec du chargement des scripts globaux, arrêt.\n");
    return 1;
  }

  // NE PAS précharger le script de Raigeki ici : GetID() (ligne 4 du script)
  // dépend du contexte "carte en cours d'ajout" que le moteur ne fixe que
  // lorsqu'il appelle lui-même scriptReader depuis OCG_DuelNewCard — un essai
  // précédent avec un chargement manuel anticipé donnait
  // "attempt to index a nil value (local 's')" à cette ligne précise.
  // g_raigeki_script reste disponible pour que ScriptReader la fournisse au
  // bon moment, quand le moteur la demande lui-même.

  // Équipe 0 : Raigeki en main + deck de remplissage.
  {
    OCG_NewCardInfo info{};
    info.team = 0;
    info.duelist = 0;
    info.code = RAIGEKI_CODE;
    info.con = 0;
    info.loc = LOCATION_HAND;
    info.seq = 0;
    info.pos = POS_FACEUP_ATTACK;
    OCG_DuelNewCard(duel, &info);
  }
  for (int i = 0; i < 19; ++i) {
    OCG_NewCardInfo info{};
    info.team = 0;
    info.duelist = 0;
    info.code = 800000 + i;  // remplissage, jamais demandé en tant que carte réelle avant la pioche
    info.con = 0;
    info.loc = LOCATION_DECK;
    info.seq = 0;
    info.pos = POS_FACEDOWN_DEFENSE;
    OCG_DuelNewCard(duel, &info);
  }

  // Équipe 1 : un monstre vanille posé directement sur le terrain, cible
  // potentielle pour l'effet de Raigeki.
  {
    OCG_NewCardInfo info{};
    info.team = 1;
    info.duelist = 0;
    info.code = TEST_MONSTER_CODE;
    info.con = 1;
    info.loc = LOCATION_MZONE;
    info.seq = 0;
    info.pos = POS_FACEUP_ATTACK;
    OCG_DuelNewCard(duel, &info);
  }
  for (int i = 0; i < 20; ++i) {
    OCG_NewCardInfo info{};
    info.team = 1;
    info.duelist = 0;
    info.code = 800100 + i;
    info.con = 1;
    info.loc = LOCATION_DECK;
    info.seq = 0;
    info.pos = POS_FACEDOWN_DEFENSE;
    OCG_DuelNewCard(duel, &info);
  }

  OCG_StartDuel(duel);

  for (int iter = 0; iter < 30; ++iter) {
    int result = OCG_DuelProcess(duel);
    uint32_t length = 0;
    void* buf = OCG_DuelGetMessage(duel, &length);
    std::printf("-- iteration %d : statut=%d, %u octets de messages --\n", iter, result, length);
    PrintMessages(static_cast<const uint8_t*>(buf), length, /*hexDump=*/true);

    if (result == OCG_DUEL_STATUS_END) {
      std::printf("Duel termine.\n");
      break;
    }
    if (result == OCG_DUEL_STATUS_AWAITING) {
      std::printf(
          "En attente d'une reponse joueur -- le POC s'arrete ici (pas de pilotage complet du protocole "
          "interactif, cf. plan Phase 1).\n");
      std::printf(
          "CONCLUSION : si aucune erreur Lua n'est apparue ci-dessus pendant le chargement/l'enregistrement "
          "du script reel de Raigeki, le moteur l'a accepte et propose maintenant un choix d'action au joueur "
          "-- preuve que le script Project Ignis reel s'execute correctement contre ce build.\n");
      break;
    }
  }

  OCG_DestroyDuel(duel);
  return 0;
}
