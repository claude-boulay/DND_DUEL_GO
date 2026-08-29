// Phase 0 : preuve de faisabilité de l'intégration ocgcore (moteur d'EDOPro).
// Crée un duel minimal avec deux monstres Normal fictifs (aucun script Lua
// requis pour ceux-là — voir README.md d'ygopro-core : le scriptReader n'est
// appelé par le moteur QUE si la carte en a besoin), fait tourner la state
// machine et affiche les messages reçus en clair. Objectif unique : prouver
// que le moteur compile, se lance, et produit un flux de messages cohérent
// (tour, phase, pioche...) — pas encore de script de carte officielle réel,
// ça viendra une fois cette base confirmée.
//
// Voir C:\Users\boula\.claude\plans\kind-drifting-token.md pour le contexte complet.

#include <cstdio>
#include <cstdint>
#include <cstring>
#include <vector>

#include "ocgapi.h"
#include "ocgapi_constants.h"

namespace {

struct TestCard {
  uint32_t code;
  uint32_t type;
  uint32_t level;
  uint32_t attribute;
  uint64_t race;
  int32_t atk;
  int32_t def;
};

// Passcodes fictifs (jamais attribués à une vraie carte officielle) : pas de
// script cX.lua à fournir, comportement "vanille" attendu du moteur.
constexpr TestCard TEST_CARDS[] = {
    {900001, TYPE_MONSTER | TYPE_NORMAL, 4, ATTRIBUTE_EARTH, RACE_WARRIOR, 1900, 1000},
    {900002, TYPE_MONSTER | TYPE_NORMAL, 4, ATTRIBUTE_DARK, RACE_FIEND, 1800, 1200},
};

const char* MessageName(uint8_t type) {
  switch (type) {
    case MSG_RETRY: return "RETRY";
    case MSG_HINT: return "HINT";
    case MSG_WAITING: return "WAITING";
    case MSG_START: return "START";
    case MSG_WIN: return "WIN";
    case MSG_SELECT_BATTLECMD: return "SELECT_BATTLECMD";
    case MSG_SELECT_IDLECMD: return "SELECT_IDLECMD";
    case MSG_SELECT_YESNO: return "SELECT_YESNO";
    case MSG_SELECT_CARD: return "SELECT_CARD";
    case MSG_SELECT_TRIBUTE: return "SELECT_TRIBUTE";
    case MSG_SELECT_PLACE: return "SELECT_PLACE";
    case MSG_SELECT_POSITION: return "SELECT_POSITION";
    case MSG_SHUFFLE_DECK: return "SHUFFLE_DECK";
    case MSG_NEW_TURN: return "NEW_TURN";
    case MSG_NEW_PHASE: return "NEW_PHASE";
    case MSG_MOVE: return "MOVE";
    case MSG_SET: return "SET";
    case MSG_SUMMONING: return "SUMMONING";
    case MSG_SUMMONED: return "SUMMONED";
    case MSG_DRAW: return "DRAW";
    case MSG_DAMAGE: return "DAMAGE";
    case MSG_LPUPDATE: return "LPUPDATE";
    case MSG_ATTACK: return "ATTACK";
    case MSG_BATTLE: return "BATTLE";
    default: return "?";
  }
}

void CardReader(void* /*payload*/, uint32_t code, OCG_CardData* data) {
  std::memset(data, 0, sizeof(OCG_CardData));
  for (const auto& c : TEST_CARDS) {
    if (c.code == code) {
      data->code = c.code;
      data->type = c.type;
      data->level = c.level;
      data->attribute = c.attribute;
      data->race = c.race;
      data->attack = c.atk;
      data->defense = c.def;
      static const uint16_t empty_setcodes[] = {0};
      data->setcodes = const_cast<uint16_t*>(empty_setcodes);
      return;
    }
  }
  std::fprintf(stderr, "[cardReader] code inconnu demandé : %u\n", code);
  data->code = code;
}

void CardReaderDone(void* /*payload*/, OCG_CardData* /*data*/) {
  // Rien à libérer : CardReader ne fait pas d'allocation dynamique.
}

int ScriptReader(void* /*payload*/, OCG_Duel /*duel*/, const char* name) {
  // Nos cartes de test sont "vanille" (TYPE_NORMAL) : le moteur les accepte
  // sans script, comme n'importe quel monstre Normal officiel sans effet.
  std::printf("[scriptReader] demande : %s (aucun script fourni pour ce POC)\n", name);
  return 0;
}

void LogHandler(void* /*payload*/, const char* string, int type) {
  std::printf("[core log type=%d] %s\n", type, string);
}

void PrintMessages(const uint8_t* buf, uint32_t length) {
  uint32_t offset = 0;
  while (offset + 4 <= length) {
    uint32_t msg_len;
    std::memcpy(&msg_len, buf + offset, sizeof(msg_len));
    offset += 4;
    if (offset + msg_len > length || msg_len == 0) break;
    uint8_t msg_type = buf[offset];
    std::printf("  message type=%3u (%-16s) taille=%u\n", msg_type, MessageName(msg_type), msg_len);
    offset += msg_len;
  }
}

}  // namespace

int main() {
  int major = 0, minor = 0;
  OCG_GetVersion(&major, &minor);
  std::printf("ocgcore version %d.%d\n", major, minor);

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
  if (status != 0) {
    std::fprintf(stderr, "Échec de création du duel, arrêt.\n");
    return 1;
  }

  // 20 cartes par équipe dans le deck (pas de deck légal complet : simple
  // preuve de vie du moteur, pas une vraie partie).
  for (uint8_t team = 0; team < 2; ++team) {
    for (int i = 0; i < 20; ++i) {
      OCG_NewCardInfo info{};
      info.team = team;
      info.duelist = 0;
      info.code = (i % 2 == 0) ? TEST_CARDS[0].code : TEST_CARDS[1].code;
      info.con = team;
      info.loc = LOCATION_DECK;
      info.seq = 0;
      info.pos = POS_FACEDOWN_DEFENSE;
      OCG_DuelNewCard(duel, &info);
    }
  }

  OCG_StartDuel(duel);

  for (int iter = 0; iter < 30; ++iter) {
    int result = OCG_DuelProcess(duel);
    uint32_t length = 0;
    void* buf = OCG_DuelGetMessage(duel, &length);
    std::printf("-- itération %d : statut=%d, %u octets de messages --\n", iter, result, length);
    PrintMessages(static_cast<const uint8_t*>(buf), length);

    if (result == OCG_DUEL_STATUS_END) {
      std::printf("Duel terminé.\n");
      break;
    }
    if (result == OCG_DUEL_STATUS_AWAITING) {
      std::printf("En attente d'une réponse joueur — le POC s'arrête ici (aucune IA branchée).\n");
      break;
    }
  }

  OCG_DestroyDuel(duel);
  return 0;
}
