// Serveur de duel ocgcore : un process par duel, piloté par le backend Node
// via un protocole texte ligne-par-ligne sur stdin/stdout. Remplace le
// plateau manuel : toute la mécanique (invocation, combat, chaîne, résolution
// d'effet des cartes officielles) est déléguée à ce process.
//
// Sources des données :
//  - Cartes officielles : BabelCDB (SQLite, ProjectIgnis/BabelCDB) pour les
//    stats, arbre CardScripts (ProjectIgnis/CardScripts) pour les scripts Lua.
//  - Cartes custom (§3.4 CLAUDE.md) : le MJ doit fournir un vrai script Lua à
//    la création de la carte (l'auto-génération fiable d'un script à partir
//    d'un texte libre n'est pas possible, mais EXIGER le script réel du MJ
//    l'est). Le script est envoyé au process via CUSTOMSCRIPT et chargé par
//    ScriptReader exactement comme un script officiel — PAS préchargé
//    directement via OCG_LoadScript avant l'ajout de la carte : un essai en
//    Phase 1 a montré que GetID() (utilisé par la plupart des scripts, y
//    compris ceux suivant la même convention) dépend d'un contexte que le
//    moteur ne fixe que lorsqu'IL appelle lui-même ScriptReader depuis
//    OCG_DuelNewCard. Stats fournies via CUSTOMCARD sous un code numérique
//    synthétique alloué par le backend (voir backend/src/utils/engineCardCode.ts).
//
// Protocole (une commande par ligne sur stdin) :
//   CREATE <flags_hex> <lp1> <hand1> <draw1> <lp2> <hand2> <draw2>
//   CUSTOMCARD <code> <type_hex> <level> <attribute_hex> <race_hex> <atk> <def>
//   CUSTOMSCRIPT <code> <hex>        (script Lua du MJ, encodé en hexa)
//   CARD <team> <code> <con> <loc_hex> <seq> <pos_hex>
//   START
//   PROCESS
//   RESPOND <hex>
//   QUERY_FIELD
//   QUERY_LOCATION <con> <loc_hex> <flags_hex>
//   QUIT
// Réponses (stdout) :
//   CREATED <status>
//   CUSTOMCARDED
//   CUSTOMSCRIPTED
//   CARDED
//   LOG <ERROR|SCRIPT|DEBUG> <texte sur une ligne>
//   MSG <type> <hex>
//   DONE <status>          (fin d'un lot de messages pour START/PROCESS)
//   FIELD <hex>             (réponse à QUERY_FIELD)
//   LOCATION <hex>          (réponse à QUERY_LOCATION — OCG_DuelQueryLocation,
//                            format lu directement dans ocgapi.cpp/card.cpp :
//                            uint32 taille totale, puis pour chaque emplacement
//                            soit un int16=0 (zone vide), soit une suite
//                            d'entrées TLV [uint16 taille][uint32 QUERY_*][valeur]
//                            terminée par une entrée QUERY_END — voir
//                            backend/src/services/ocgcoreClient.ts pour le
//                            parseur côté Node.)
//
// Voir C:\Users\boula\.claude\plans\kind-drifting-token.md pour le contexte.

#include <cstdio>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sqlite3.h>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "ocgapi.h"
#include "ocgapi_constants.h"

namespace {

constexpr const char* CARDS_CDB_PATH = "data/cards.cdb";
constexpr const char* SCRIPTS_ROOT = "data/CardScripts";

struct CustomCardData {
  uint32_t type;
  uint32_t level;
  uint32_t attribute;
  uint64_t race;
  int32_t atk;
  int32_t def;
};

sqlite3* g_db = nullptr;
std::unordered_map<uint32_t, CustomCardData> g_custom_cards;
// Scripts custom fournis par le MJ, indexés par le nom exact que le moteur
// demandera ("c<code>.lua") — voir ScriptReader.
std::unordered_map<std::string, std::string> g_custom_scripts;
// Cache des setcodes dépaquetés (OCG_CardData::setcodes doit rester valide
// tant que la carte existe pour le moteur — on garde donc le buffer en vie).
std::unordered_map<uint32_t, std::vector<uint16_t>> g_setcode_cache;

std::string ReadFile(const std::string& path) {
  std::ifstream f(path, std::ios::binary);
  std::ostringstream ss;
  ss << f.rdbuf();
  return ss.str();
}

bool FileExists(const std::string& path) {
  std::ifstream f(path);
  return f.good();
}

std::string ToHex(const uint8_t* data, uint32_t len) {
  static const char* digits = "0123456789abcdef";
  std::string out;
  out.reserve(len * 2);
  for (uint32_t i = 0; i < len; ++i) {
    out.push_back(digits[data[i] >> 4]);
    out.push_back(digits[data[i] & 0xf]);
  }
  return out;
}

std::string FromHex(const std::string& hex) {
  std::string out;
  out.reserve(hex.size() / 2);
  for (size_t i = 0; i + 1 < hex.size(); i += 2) {
    out.push_back(static_cast<char>(std::stoi(hex.substr(i, 2), nullptr, 16)));
  }
  return out;
}

// Le setcode BabelCDB packe jusqu'à 4 codes d'archétype de 16 bits sur un
// entier 64 bits (0 = case vide) ; OCG_CardData::setcodes veut un tableau
// uint16_t terminé par 0 (convention ygopro standard, inchangée depuis des années).
std::vector<uint16_t> UnpackSetcodes(int64_t packed) {
  std::vector<uint16_t> out;
  for (int i = 0; i < 4; ++i) {
    uint16_t part = static_cast<uint16_t>((static_cast<uint64_t>(packed) >> (i * 16)) & 0xffff);
    if (part != 0) out.push_back(part);
  }
  out.push_back(0);
  return out;
}

void CardReader(void* /*payload*/, uint32_t code, OCG_CardData* data) {
  std::memset(data, 0, sizeof(OCG_CardData));
  data->code = code;

  auto custom_it = g_custom_cards.find(code);
  if (custom_it != g_custom_cards.end()) {
    const auto& c = custom_it->second;
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

  static const char* kQuery = "SELECT type, atk, def, level, race, attribute, setcode FROM datas WHERE id = ?";
  sqlite3_stmt* stmt = nullptr;
  if (sqlite3_prepare_v2(g_db, kQuery, -1, &stmt, nullptr) != SQLITE_OK) {
    std::fprintf(stderr, "LOG ERROR sqlite_prepare_failed:%s\n", sqlite3_errmsg(g_db));
    return;
  }
  sqlite3_bind_int64(stmt, 1, code);
  if (sqlite3_step(stmt) == SQLITE_ROW) {
    uint32_t raw_type = static_cast<uint32_t>(sqlite3_column_int64(stmt, 0));
    data->type = raw_type;
    data->attack = static_cast<int32_t>(sqlite3_column_int64(stmt, 1));
    data->defense = static_cast<int32_t>(sqlite3_column_int64(stmt, 2));
    uint32_t raw_level = static_cast<uint32_t>(sqlite3_column_int64(stmt, 3));
    // Convention ygopro standard : niveau/rang sur l'octet bas, échelles
    // Pendule sur les octets hauts (bits 16-23 = droite, 24-31 = gauche).
    data->level = raw_level & 0xff;
    data->rscale = (raw_level >> 16) & 0xff;
    data->lscale = (raw_level >> 24) & 0xff;
    data->race = static_cast<uint64_t>(sqlite3_column_int64(stmt, 4));
    data->attribute = static_cast<uint32_t>(sqlite3_column_int64(stmt, 5));
    int64_t packed_setcode = sqlite3_column_int64(stmt, 6);
    g_setcode_cache[code] = UnpackSetcodes(packed_setcode);
    data->setcodes = g_setcode_cache[code].data();
  } else {
    std::fprintf(stderr, "LOG ERROR unknown_official_card_code:%u\n", code);
  }
  sqlite3_finalize(stmt);
}

void CardReaderDone(void* /*payload*/, OCG_CardData* /*data*/) {
  // Rien à libérer explicitement : setcodes pointe vers g_setcode_cache
  // (vecteurs conservés pour la durée du process), ou vers un tableau statique.
}

// Résout un nom de script demandé par le moteur vers un chemin sur disque.
// Les scripts "globaux" (constant.lua, utility.lua, proc_*.lua...) vivent à
// la racine de CardScripts ; les scripts par carte vivent sous official/.
bool ResolveScriptPath(const std::string& name, std::string* out_path) {
  std::string root_candidate = std::string(SCRIPTS_ROOT) + "/" + name;
  if (FileExists(root_candidate)) {
    *out_path = root_candidate;
    return true;
  }
  std::string official_candidate = std::string(SCRIPTS_ROOT) + "/official/" + name;
  if (FileExists(official_candidate)) {
    *out_path = official_candidate;
    return true;
  }
  return false;
}

int ScriptReader(void* /*payload*/, OCG_Duel duel, const char* name) {
  auto custom_it = g_custom_scripts.find(name);
  if (custom_it != g_custom_scripts.end()) {
    const std::string& content = custom_it->second;
    return OCG_LoadScript(duel, content.data(), static_cast<uint32_t>(content.size()), name);
  }

  std::string path;
  if (!ResolveScriptPath(name, &path)) {
    // Carte officielle "vanille" (Normal Monster sans effet) : comportement
    // normal, pas une erreur. Une carte custom sans script associé tombera
    // aussi ici — mais elle ne devrait jamais être ajoutée à un duel sans
    // script, voir la validation côté backend (script obligatoire à la
    // création, CLAUDE.md §3.4).
    return 0;
  }
  std::string content = ReadFile(path);
  if (content.empty()) return 0;
  return OCG_LoadScript(duel, content.data(), static_cast<uint32_t>(content.size()), name);
}

void LogHandler(void* /*payload*/, const char* string, int type) {
  const char* type_name = type == OCG_LOG_TYPE_ERROR ? "ERROR" : type == OCG_LOG_TYPE_FROM_SCRIPT ? "SCRIPT" : "DEBUG";
  std::string safe(string);
  for (auto& c : safe)
    if (c == '\n' || c == '\r') c = ' ';
  std::printf("LOG %s %s\n", type_name, safe.c_str());
  std::fflush(stdout);
}

void FlushMessages(OCG_Duel duel) {
  uint32_t length = 0;
  void* buf = OCG_DuelGetMessage(duel, &length);
  const auto* p = static_cast<const uint8_t*>(buf);
  uint32_t offset = 0;
  while (offset + 4 <= length) {
    uint32_t msg_len;
    std::memcpy(&msg_len, p + offset, sizeof(msg_len));
    offset += 4;
    if (offset + msg_len > length || msg_len == 0) break;
    uint8_t msg_type = p[offset];
    std::printf("MSG %u %s\n", msg_type, ToHex(p + offset, msg_len).c_str());
    offset += msg_len;
  }
  std::fflush(stdout);
}

}  // namespace

int main() {
  if (sqlite3_open_v2(CARDS_CDB_PATH, &g_db, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK) {
    std::fprintf(stderr, "LOG ERROR cannot_open_cards_cdb:%s\n", sqlite3_errmsg(g_db));
    return 1;
  }

  std::string constant_lua = ReadFile(std::string(SCRIPTS_ROOT) + "/constant.lua");
  std::string utility_lua = ReadFile(std::string(SCRIPTS_ROOT) + "/utility.lua");
  if (constant_lua.empty() || utility_lua.empty()) {
    std::fprintf(stderr, "LOG ERROR missing_global_scripts\n");
    return 1;
  }

  OCG_Duel duel = nullptr;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    std::istringstream iss(line);
    std::string cmd;
    iss >> cmd;

    if (cmd == "CREATE") {
      std::string flags_hex;
      uint32_t lp1, hand1, draw1, lp2, hand2, draw2;
      iss >> flags_hex >> lp1 >> hand1 >> draw1 >> lp2 >> hand2 >> draw2;

      OCG_DuelOptions options{};
      options.seed[0] = 1;
      options.seed[1] = 2;
      options.seed[2] = 3;
      options.seed[3] = 4;
      options.flags = std::stoull(flags_hex, nullptr, 16);
      options.team1 = OCG_Player{lp1, hand1, draw1};
      options.team2 = OCG_Player{lp2, hand2, draw2};
      options.cardReader = CardReader;
      options.scriptReader = ScriptReader;
      options.logHandler = LogHandler;
      options.cardReaderDone = CardReaderDone;
      options.enableUnsafeLibraries = 0;

      int status = OCG_CreateDuel(&duel, &options);
      if (status == 0) {
        OCG_LoadScript(duel, constant_lua.data(), static_cast<uint32_t>(constant_lua.size()), "constant.lua");
        OCG_LoadScript(duel, utility_lua.data(), static_cast<uint32_t>(utility_lua.size()), "utility.lua");
      }
      std::printf("CREATED %d\n", status);
      std::fflush(stdout);
    } else if (cmd == "CUSTOMCARD") {
      uint32_t code, level, atk, def;
      std::string type_hex, attribute_hex, race_hex;
      iss >> code >> type_hex >> level >> attribute_hex >> race_hex >> atk >> def;
      CustomCardData c;
      c.type = std::stoul(type_hex, nullptr, 16);
      c.level = level;
      c.attribute = std::stoul(attribute_hex, nullptr, 16);
      c.race = std::stoull(race_hex, nullptr, 16);
      c.atk = static_cast<int32_t>(atk);
      c.def = static_cast<int32_t>(def);
      g_custom_cards[code] = c;
      std::printf("CUSTOMCARDED\n");
      std::fflush(stdout);
    } else if (cmd == "CUSTOMSCRIPT") {
      uint32_t code;
      std::string hex;
      iss >> code >> hex;
      std::string script_name = "c" + std::to_string(code) + ".lua";
      g_custom_scripts[script_name] = FromHex(hex);
      std::printf("CUSTOMSCRIPTED\n");
      std::fflush(stdout);
    } else if (cmd == "CARD") {
      uint32_t team, code, con, seq;
      std::string loc_hex, pos_hex;
      iss >> team >> code >> con >> loc_hex >> seq >> pos_hex;
      // duelist (Tag Duel : plusieurs decks/mains/Extra Decks partageant un
      // même camp/PV) est optionnel en fin de ligne pour rester compatible
      // avec les appels existants (0 = duelist "principal", placement direct
      // via loc/seq/pos ; >=1 = un deck/Extra Deck supplémentaire du même
      // camp, voir OCG_DuelNewCard dans ocgapi.cpp — loc doit alors être
      // DECK ou EXTRA uniquement, seq/pos sont ignorés par le moteur dans ce cas).
      uint32_t duelist = 0;
      if (!(iss >> duelist)) duelist = 0;
      OCG_NewCardInfo info{};
      info.team = static_cast<uint8_t>(team);
      info.duelist = static_cast<uint8_t>(duelist);
      info.code = code;
      info.con = static_cast<uint8_t>(con);
      info.loc = std::stoul(loc_hex, nullptr, 16);
      info.seq = seq;
      info.pos = std::stoul(pos_hex, nullptr, 16);
      OCG_DuelNewCard(duel, &info);
      std::printf("CARDED\n");
      std::fflush(stdout);
    } else if (cmd == "START") {
      OCG_StartDuel(duel);
      int result = OCG_DuelProcess(duel);
      FlushMessages(duel);
      std::printf("DONE %d\n", result);
      std::fflush(stdout);
    } else if (cmd == "PROCESS") {
      int result = OCG_DuelProcess(duel);
      FlushMessages(duel);
      std::printf("DONE %d\n", result);
      std::fflush(stdout);
    } else if (cmd == "RESPOND") {
      std::string hex;
      iss >> hex;
      std::string bytes = FromHex(hex);
      OCG_DuelSetResponse(duel, bytes.data(), static_cast<uint32_t>(bytes.size()));
      std::printf("RESPONDED\n");
      std::fflush(stdout);
    } else if (cmd == "QUERY_FIELD") {
      uint32_t length = 0;
      void* buf = OCG_DuelQueryField(duel, &length);
      std::printf("FIELD %s\n", ToHex(static_cast<const uint8_t*>(buf), length).c_str());
      std::fflush(stdout);
    } else if (cmd == "QUERY_LOCATION") {
      uint32_t con;
      std::string loc_hex, flags_hex;
      iss >> con >> loc_hex >> flags_hex;
      OCG_QueryInfo info{};
      info.con = static_cast<uint8_t>(con);
      info.loc = std::stoul(loc_hex, nullptr, 16);
      info.flags = std::stoul(flags_hex, nullptr, 16);
      uint32_t length = 0;
      void* buf = OCG_DuelQueryLocation(duel, &length, &info);
      std::printf("LOCATION %s\n", ToHex(static_cast<const uint8_t*>(buf), length).c_str());
      std::fflush(stdout);
    } else if (cmd == "QUIT") {
      break;
    } else {
      std::printf("LOG ERROR unknown_command:%s\n", cmd.c_str());
      std::fflush(stdout);
    }
  }

  if (duel) OCG_DestroyDuel(duel);
  if (g_db) sqlite3_close(g_db);
  return 0;
}
