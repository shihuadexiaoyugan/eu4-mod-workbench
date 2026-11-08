/**
 * Bilingual dictionary for GUI form options.
 *
 * The UI renders `label` (Chinese); the payload/prompt only ever carries
 * `value` (the native EU4 anchor code or trigger expression). Keep this file
 * the single source of truth for both the Web form and the server endpoint.
 */

export const GUI_ANCHORS = [
  { value: 'left_of_coins', label: '国库(金币)左侧' },
  { value: 'right_of_coins', label: '国库(金币)右侧' },
  { value: 'left_of_stability', label: '稳定度左侧' },
  { value: 'right_of_stability', label: '稳定度右侧' },
  { value: 'left_of_manpower', label: '人力左侧' },
  { value: 'right_of_manpower', label: '人力右侧' },
  { value: 'top_center', label: '屏幕正上方' },
  { value: 'top_left', label: '左上角' },
  { value: 'top_right', label: '右上角' },
] as const;

export const GUI_VISIBILITIES = [
  { value: 'always', label: '所有国家可见' },
  { value: 'tag = BOH', label: '仅波希米亚 (BOH) 可见' },
  { value: 'religion = hussite', label: '仅胡斯信仰可见' },
  { value: 'has_country_flag = hussite_zeal_unlocked', label: '仅拥有胡斯狂热 flag 可见' },
  { value: 'is_emperor = yes', label: '仅神罗皇帝可见' },
  { value: 'government = monarchy', label: '仅君主制可见' },
] as const;

/** A selectable game-data entry: value is the English code sent to the AI. */
export interface GameOption {
  value: string;
  label: string;
  /** Chinese/pinyin/English search tokens; not shown in the UI. */
  keywords: string;
  /** Whether the numeric value is a percentage (0.05), a flat integer (5), or a raw decimal (0.1). */
  type?: 'percentage' | 'integer' | 'decimal';
  /** `<category>.<group>` for tree grouping (modifiers only). */
  group?: string;
}

export type ModifierValueType = 'percentage' | 'integer' | 'decimal';

export interface ModifierDef {
  value: string;
  label: string;
  /** `<category>.<group>` */
  group: string;
  type: ModifierValueType;
}

export const MODIFIER_CATEGORIES = [
  { id: 'military', label: '军事' },
  { id: 'economy', label: '经济' },
  { id: 'diplomacy', label: '外交' },
  { id: 'internal', label: '内部' },
  { id: 'misc', label: '其他' },
] as const;

export const MODIFIER_GROUPS: Record<string, string> = {
  'military.army': '陆军',
  'military.navy': '海军',
  'military.leader': '将领',
  'military.fort': '要塞与损耗',
  'military.mercenary': '雇佣兵',
  'economy.tax': '税收与国家',
  'economy.trade': '生产与贸易',
  'economy.development': '发展与建筑',
  'economy.technology': '科技与理念',
  'economy.finance': '财政与宫廷',
  'diplomacy.reputation': '外交与声望',
  'diplomacy.subject': '附庸与吞并',
  'diplomacy.war': '战争与宣战',
  'diplomacy.espionage': '间谍与颠覆',
  'diplomacy.colonisation': '殖民与海外',
  'internal.stability': '稳定与政体',
  'internal.unrest': '叛乱与自治',
  'internal.religion': '宗教',
  'internal.culture': '文化',
  'misc.province': '省份数值',
  'misc.fleet': '舰队与旗舰',
  'misc.special': '特殊',
};

const M = (value: string, label: string, group: string, type: ModifierValueType = 'percentage'): ModifierDef => ({
  value, label, group, type,
});

/**
 * Full modifier catalogue. Keys come from the game's own modifier list
 * (`lib/docs-data.json`, sourced from EU4-Documentation's modifiers.txt),
 * labels are Chinese, and `M()` groups them into the UI tree.
 */
export const MODIFIER_DEFS: ModifierDef[] = [
  /* ---------------------------- 军事 · 陆军 ---------------------------- */
  M('army_tradition', '陆军传统', 'military.army', 'integer'),
  M('army_tradition_decay', '陆军传统衰减', 'military.army'),
  M('army_tradition_from_battle', '战斗获得陆军传统', 'military.army'),
  M('yearly_army_professionalism', '每年陆军职业度', 'military.army', 'decimal'),
  M('drill_gain_modifier', '训练度获取', 'military.army'),
  M('drill_decay_modifier', '训练度衰减', 'military.army'),
  M('land_morale', '陆军士气', 'military.army'),
  M('discipline', '纪律', 'military.army'),
  M('mercenary_discipline', '雇佣兵纪律', 'military.army'),
  M('recover_army_morale_speed', '陆军士气恢复速度', 'military.army'),
  M('infantry_cost', '步兵花费', 'military.army'),
  M('infantry_power', '步兵战斗力', 'military.army'),
  M('infantry_fire', '步兵火力', 'military.army', 'integer'),
  M('infantry_shock', '步兵冲击', 'military.army', 'integer'),
  M('cavalry_cost', '骑兵花费', 'military.army'),
  M('cavalry_power', '骑兵战斗力', 'military.army'),
  M('cavalry_fire', '骑兵火力', 'military.army', 'integer'),
  M('cavalry_shock', '骑兵冲击', 'military.army', 'integer'),
  M('cavalry_flanking', '骑兵侧翼攻击', 'military.army'),
  M('cav_to_inf_ratio', '骑兵步兵比例', 'military.army'),
  M('artillery_cost', '炮兵花费', 'military.army'),
  M('artillery_power', '炮兵战斗力', 'military.army'),
  M('artillery_fire', '炮兵火力', 'military.army', 'integer'),
  M('artillery_shock', '炮兵冲击', 'military.army', 'integer'),
  M('artillery_bonus_vs_fort', '炮兵对要塞加成', 'military.army', 'integer'),
  M('backrow_artillery_damage', '后排炮兵伤害', 'military.army'),
  M('movement_speed', '陆军移动速度', 'military.army'),
  M('movement_speed_onto_off_boat_modifier', '上船下船速度', 'military.army'),
  M('fire_damage', '火力伤害', 'military.army'),
  M('fire_damage_received', '受到火力伤害', 'military.army'),
  M('shock_damage', '冲击伤害', 'military.army'),
  M('shock_damage_received', '受到冲击伤害', 'military.army'),
  M('reserves_organisation', '预备队组织度', 'military.army'),
  M('land_attrition', '陆军损耗', 'military.army'),
  M('reinforce_cost_modifier', '补员花费', 'military.army'),
  M('reinforce_speed', '补员速度', 'military.army'),
  M('manpower_recovery_speed', '人力恢复速度', 'military.army'),
  M('global_manpower', '全国人力', 'military.army', 'integer'),
  M('global_manpower_modifier', '人力上限', 'military.army'),
  M('global_regiment_cost', '全国团花费', 'military.army'),
  M('global_regiment_recruit_speed', '全国团招募速度', 'military.army'),
  M('land_forcelimit', '陆军上限', 'military.army', 'integer'),
  M('land_forcelimit_modifier', '陆军上限百分比', 'military.army'),
  M('land_maintenance_modifier', '陆军维护费', 'military.army'),
  M('prestige_from_land', '陆军获得威望', 'military.army'),
  M('war_exhaustion', '战争疲劳', 'military.army'),
  M('war_exhaustion_cost', '战争疲劳花费', 'military.army'),
  M('war_taxes_cost_modifier', '战争税花费', 'military.army'),
  M('raze_power_gain', '劫掠点数获取', 'military.army'),
  M('loot_amount', '劫掠量', 'military.army'),
  M('siege_ability', '围城能力', 'military.army'),
  M('siege_blockade_progress', '围城封锁进度', 'military.army'),

  /* ---------------------------- 军事 · 海军 ---------------------------- */
  M('navy_tradition', '海军传统', 'military.navy', 'integer'),
  M('navy_tradition_decay', '海军传统衰减', 'military.navy'),
  M('naval_tradition_from_trade', '贸易获得海军传统', 'military.navy'),
  M('naval_tradition_from_battle', '战斗获得海军传统', 'military.navy'),
  M('naval_morale', '海军士气', 'military.navy'),
  M('recover_navy_morale_speed', '海军士气恢复速度', 'military.navy'),
  M('naval_attrition', '海军损耗', 'military.navy'),
  M('naval_forcelimit', '海军上限', 'military.navy', 'integer'),
  M('naval_forcelimit_modifier', '海军上限百分比', 'military.navy'),
  M('naval_maintenance_modifier', '海军维护费', 'military.navy'),
  M('global_naval_engagement_modifier', '海军交战宽度', 'military.navy'),
  M('blockade_efficiency', '封锁效率', 'military.navy'),
  M('capture_ship_chance', '俘获船只几率', 'military.navy'),
  M('ship_durability', '船只耐久', 'military.navy'),
  M('sunk_ship_morale_hit_recieved', '沉船士气打击', 'military.navy'),
  M('own_coast_naval_combat_bonus', '本土海岸海战加成', 'military.navy', 'integer'),
  M('prestige_from_naval', '海军获得威望', 'military.navy'),
  M('heavy_ship_cost', '重型船只花费', 'military.navy'),
  M('heavy_ship_power', '重型船只战斗力', 'military.navy'),
  M('light_ship_cost', '轻型船只花费', 'military.navy'),
  M('light_ship_power', '轻型船只战斗力', 'military.navy'),
  M('galley_cost', '桨帆船花费', 'military.navy'),
  M('galley_power', '桨帆船战斗力', 'military.navy'),
  M('transport_cost', '运输船花费', 'military.navy'),
  M('transport_power', '运输船战斗力', 'military.navy'),
  M('global_ship_cost', '全国船只花费', 'military.navy'),
  M('global_ship_recruit_speed', '全国船只招募速度', 'military.navy'),
  M('global_ship_repair', '全国船只修理', 'military.navy'),
  M('ship_recruit_speed', '船只招募速度', 'military.navy'),
  M('global_sailors', '全国水手', 'military.navy', 'integer'),
  M('global_sailors_modifier', '水手上限', 'military.navy'),
  M('sailor_maintenance_modifer', '水手维护费', 'military.navy'),
  M('sailors_recovery_speed', '水手恢复速度', 'military.navy'),
  M('global_naval_barrage_cost', '海军炮击花费', 'military.navy'),

  /* ---------------------------- 军事 · 将领 ---------------------------- */
  M('leader_cost', '将领花费', 'military.leader'),
  M('general_cost', '陆军将领花费', 'military.leader'),
  M('admiral_cost', '海军将领花费', 'military.leader'),
  M('free_leader_pool', '免费将领名额', 'military.leader', 'integer'),
  M('leader_land_fire', '陆军将领火力', 'military.leader', 'integer'),
  M('leader_land_shock', '陆军将领冲击', 'military.leader', 'integer'),
  M('leader_land_manuever', '陆军将领机动', 'military.leader', 'integer'),
  M('leader_siege', '将领围城', 'military.leader', 'integer'),
  M('leader_naval_fire', '海军将领火力', 'military.leader', 'integer'),
  M('leader_naval_shock', '海军将领冲击', 'military.leader', 'integer'),
  M('leader_naval_manuever', '海军将领机动', 'military.leader', 'integer'),
  M('admiral_skill_gain_modifier', '海军将领技能增长', 'military.leader'),

  /* -------------------------- 军事 · 要塞与损耗 -------------------------- */
  M('defensiveness', '防御力', 'military.fort'),
  M('fort_maintenance_modifier', '要塞维护费', 'military.fort'),
  M('rival_border_fort_maintenance', '敌对边境要塞维护费', 'military.fort'),
  M('garrison_size', '驻军规模', 'military.fort'),
  M('global_garrison_growth', '全国驻军增长', 'military.fort'),
  M('garrison_growth', '驻军增长', 'military.fort'),
  M('fort_level', '要塞等级', 'military.fort', 'integer'),
  M('local_defensiveness', '本地防御力', 'military.fort'),
  M('hostile_attrition', '敌方损耗', 'military.fort', 'integer'),
  M('local_hostile_attrition', '本地敌方损耗', 'military.fort', 'integer'),
  M('max_attrition', '最大损耗', 'military.fort', 'integer'),
  M('attrition', '损耗', 'military.fort', 'integer'),
  M('global_supply_limit_modifier', '全国补给上限', 'military.fort'),
  M('supply_limit', '补给上限', 'military.fort'),
  M('supply_limit_modifier', '补给上限百分比', 'military.fort'),

  /* --------------------------- 军事 · 雇佣兵 --------------------------- */
  M('mercenary_cost', '雇佣兵花费', 'military.mercenary'),
  M('merc_maintenance_modifier', '雇佣兵维护费', 'military.mercenary'),
  M('possible_condottieri', '可雇佣雇佣兵比例', 'military.mercenary'),
  M('possible_mercenaries', '可雇佣雇佣兵数量', 'military.mercenary', 'integer'),
  M('local_regiment_cost', '本地团花费', 'military.mercenary'),
  M('regiment_recruit_speed', '团招募速度', 'military.mercenary'),
  M('local_friendly_movement_speed', '本地友军移动速度', 'military.mercenary'),
  M('local_hostile_movement_speed', '本地敌军移动速度', 'military.mercenary'),
  M('amount_of_banners', '八旗数量', 'military.mercenary'),
  M('has_banners', '拥有八旗', 'military.mercenary', 'integer'),

  /* --------------------------- 经济 · 税收与国家 --------------------------- */
  M('global_tax_modifier', '全国税收', 'economy.tax'),
  M('global_tax_income', '全国税收收入', 'economy.tax', 'integer'),
  M('tax_income', '税收收入', 'economy.tax', 'integer'),
  M('local_tax_modifier', '本地税收', 'economy.tax'),
  M('state_maintenance_modifier', '州维护费', 'economy.tax'),
  M('local_state_maintenance_modifier', '本地州维护费', 'economy.tax'),
  M('administrative_efficiency', '行政效率', 'economy.tax'),
  M('allowed_num_of_buildings', '可建建筑数量', 'economy.tax', 'integer'),

  /* -------------------------- 经济 · 生产与贸易 -------------------------- */
  M('production_efficiency', '生产效率', 'economy.trade'),
  M('local_production_efficiency', '本地生产效率', 'economy.trade'),
  M('trade_efficiency', '贸易效率', 'economy.trade'),
  M('trade_range_modifier', '贸易范围', 'economy.trade'),
  M('trade_steering', '贸易转向', 'economy.trade'),
  M('global_trade_power', '全国贸易力量', 'economy.trade'),
  M('global_foreign_trade_power', '对外贸力量', 'economy.trade'),
  M('global_own_trade_power', '本地贸易力量', 'economy.trade'),
  M('global_prov_trade_power_modifier', '省份贸易竞争力', 'economy.trade'),
  M('global_ship_trade_power', '船只贸易力量', 'economy.trade'),
  M('placed_merchant_power', '派驻商人力量', 'economy.trade'),
  M('privateer_efficiency', '私掠效率', 'economy.trade'),
  M('embargo_efficiency', '禁运效率', 'economy.trade'),
  M('ship_power_propagation', '船只力量传递', 'economy.trade'),
  M('center_of_trade_upgrade_cost', '贸易中心升级花费', 'economy.trade'),
  M('trade_company_investment_cost', '贸易公司投资花费', 'economy.trade'),
  M('caravan_power', '商队力量', 'economy.trade'),
  M('merchants', '商人数量', 'economy.trade', 'integer'),
  M('global_trade_goods_size_modifier', '贸易商品规模修正', 'economy.trade'),
  M('trade_goods_size', '贸易商品规模', 'economy.trade'),
  M('trade_goods_size_modifier', '贸易商品规模', 'economy.trade'),
  M('trade_value', '贸易价值', 'economy.trade', 'integer'),
  M('trade_value_modifier', '贸易价值修正', 'economy.trade'),
  M('province_trade_power_modifier', '省份贸易竞争力', 'economy.trade'),
  M('province_trade_power_value', '省份贸易竞争力值', 'economy.trade'),
  M('global_tariffs', '全国关税', 'economy.trade'),
  M('treasure_fleet_income', '宝藏船队收入', 'economy.trade'),

  /* -------------------------- 经济 · 发展与建筑 -------------------------- */
  M('development_cost', '发展成本', 'economy.development'),
  M('local_development_cost', '本地发展成本', 'economy.development'),
  M('cs_only_local_development_cost', '本地发展成本（自定义）', 'economy.development'),
  M('build_cost', '建筑花费', 'economy.development'),
  M('build_time', '建筑时间', 'economy.development'),
  M('local_build_cost', '本地建筑花费', 'economy.development'),
  M('local_build_time', '本地建筑时间', 'economy.development'),
  M('core_creation', '造核成本', 'economy.development'),
  M('local_core_creation', '本地造核成本', 'economy.development'),
  M('enemy_core_creation', '敌方造核', 'economy.development'),
  M('core_decay_on_your_own', '自身核心衰减', 'economy.development'),
  M('local_monthly_devastation', '本地每月破坏', 'economy.development'),

  /* -------------------------- 经济 · 科技与理念 -------------------------- */
  M('technology_cost', '科技花费', 'economy.technology'),
  M('adm_tech_cost_modifier', '行政科技花费', 'economy.technology'),
  M('dip_tech_cost_modifier', '外交科技花费', 'economy.technology'),
  M('mil_tech_cost_modifier', '军事科技花费', 'economy.technology'),
  M('idea_cost', '理念花费', 'economy.technology'),
  M('all_power_cost', '全点数花费', 'economy.technology'),
  M('embracement_cost', '接纳制度花费', 'economy.technology'),
  M('global_institution_spread', '全国制度传播', 'economy.technology'),
  M('institution_spread_from_true_faith', '真信制度传播', 'economy.technology'),
  M('local_institution_spread', '本地制度传播', 'economy.technology'),
  M('innovativeness_gain', '创新度获取', 'economy.technology', 'integer'),
  M('free_adm_policy', '免费行政政策', 'economy.technology', 'integer'),
  M('free_dip_policy', '免费外交政策', 'economy.technology', 'integer'),
  M('free_mil_policy', '免费军事政策', 'economy.technology', 'integer'),
  M('possible_adm_policy', '可行政政策', 'economy.technology', 'integer'),
  M('possible_dip_policy', '可外交政策', 'economy.technology', 'integer'),
  M('possible_mil_policy', '可军事政策', 'economy.technology', 'integer'),
  M('free_policy', '免费政策', 'economy.technology', 'integer'),
  M('reform_progress_growth', '改革进度增长', 'economy.technology'),

  /* -------------------------- 经济 · 财政与宫廷 -------------------------- */
  M('interest', '贷款利息', 'economy.finance'),
  M('inflation_reduction', '通胀降低', 'economy.finance'),
  M('inflation_reduction_local', '本地通胀降低', 'economy.finance'),
  M('inflation_action_cost', '通胀行动花费', 'economy.finance'),
  M('yearly_corruption', '每年腐败', 'economy.finance', 'decimal'),
  M('advisor_cost', '顾问花费', 'economy.finance'),
  M('adm_advisor_cost', '行政顾问花费', 'economy.finance'),
  M('dip_advisor_cost', '外交顾问花费', 'economy.finance'),
  M('mil_advisor_cost', '军事顾问花费', 'economy.finance'),
  M('advisor_pool', '顾问池', 'economy.finance', 'integer'),
  M('female_advisor_chance', '女性顾问几率', 'economy.finance'),
  M('heir_chance', '继承人几率', 'economy.finance'),
  M('monarch_admin_power', '君主行政点数', 'economy.finance', 'integer'),
  M('monarch_diplomatic_power', '君主外交点数', 'economy.finance', 'integer'),
  M('monarch_military_power', '君主军事点数', 'economy.finance', 'integer'),
  M('monthly_support_heir_gain', '每月支持继承人', 'economy.finance', 'decimal'),

  /* -------------------------- 外交 · 外交与声望 -------------------------- */
  M('diplomats', '外交官数量', 'diplomacy.reputation', 'integer'),
  M('diplomatic_reputation', '外交声望', 'diplomacy.reputation', 'integer'),
  M('diplomatic_upkeep', '外交维护费', 'diplomacy.reputation', 'integer'),
  M('envoy_travel_time', '使节旅行时间', 'diplomacy.reputation'),
  M('improve_relation_modifier', '改善关系', 'diplomacy.reputation'),
  M('ae_impact', '侵略扩张影响', 'diplomacy.reputation'),
  M('claim_duration', '宣称持续时间', 'diplomacy.reputation'),
  M('discovered_relations_impact', '被发现关系影响', 'diplomacy.reputation'),
  M('prestige', '威望', 'diplomacy.reputation', 'integer'),
  M('prestige_decay', '威望衰减', 'diplomacy.reputation'),
  M('power_projection_from_insults', '侮辱获得威望投射', 'diplomacy.reputation'),

  /* -------------------------- 外交 · 附庸与吞并 -------------------------- */
  M('vassal_forcelimit_bonus', '附庸贡献上限', 'diplomacy.subject'),
  M('vassal_income', '附庸收入', 'diplomacy.subject'),
  M('liberty_desire', '独立倾向', 'diplomacy.subject', 'integer'),
  M('liberty_desire_from_subject_development', '发展度带来的独立倾向', 'diplomacy.subject', 'integer'),
  M('reduced_liberty_desire', '降低独立倾向', 'diplomacy.subject', 'integer'),
  M('reduced_liberty_desire_on_same_continent', '同大陆降低独立倾向', 'diplomacy.subject', 'integer'),
  M('diplomatic_annexation_cost', '外交吞并花费', 'diplomacy.subject'),

  /* -------------------------- 外交 · 战争与宣战 -------------------------- */
  M('province_warscore_cost', '省份战争分数花费', 'diplomacy.war'),
  M('unjustified_demands', '不正当要求', 'diplomacy.war'),
  M('warscore_cost_vs_other_religion', '对异教战争分数花费', 'diplomacy.war', 'integer'),
  M('fabricate_claims_cost', '伪造宣称花费', 'diplomacy.war'),
  M('justify_trade_conflict_cost', '贸易冲突宣战理由花费', 'diplomacy.war'),
  M('rival_change_cost', '更换宿敌花费', 'diplomacy.war'),

  /* -------------------------- 外交 · 间谍与颠覆 -------------------------- */
  M('spy_offence', '间谍进攻', 'diplomacy.espionage'),
  M('global_spy_defence', '全国间谍防御', 'diplomacy.espionage'),
  M('rebel_support_efficiency', '叛军支持效率', 'diplomacy.espionage'),

  /* -------------------------- 外交 · 殖民与海外 -------------------------- */
  M('colonists', '殖民者数量', 'diplomacy.colonisation', 'integer'),
  M('colonist_placement_chance', '殖民成功率', 'diplomacy.colonisation'),
  M('local_colonist_placement_chance', '本地殖民成功率', 'diplomacy.colonisation'),
  M('global_colonial_growth', '全国殖民增长', 'diplomacy.colonisation', 'integer'),
  M('local_colonial_growth', '本地殖民增长', 'diplomacy.colonisation', 'integer'),
  M('range', '殖民范围', 'diplomacy.colonisation'),
  M('native_uprising_chance', '原住民起义几率', 'diplomacy.colonisation'),
  M('native_assimilation', '原住民同化', 'diplomacy.colonisation'),
  M('native_advancement_cost', '原住民进步花费', 'diplomacy.colonisation'),
  M('migration_cooldown', '迁移冷却', 'diplomacy.colonisation'),
  M('expel_minorities_cost', '驱逐少数民族花费', 'diplomacy.colonisation'),

  /* -------------------------- 内部 · 稳定与政体 -------------------------- */
  M('legitimacy', '合法性', 'internal.stability', 'integer'),
  M('republican_tradition', '共和传统', 'internal.stability', 'decimal'),
  M('devotion', '虔诚', 'internal.stability', 'decimal'),
  M('horde_unity', '游牧团结', 'internal.stability', 'decimal'),
  M('meritocracy', '精英政治', 'internal.stability', 'decimal'),
  M('stability_cost_modifier', '稳定度花费', 'internal.stability'),
  M('imperial_authority', '帝国权威', 'internal.stability', 'decimal'),
  M('imperial_authority_value', '帝国权威值', 'internal.stability', 'integer'),
  M('imperial_mandate', '天命', 'internal.stability', 'integer'),
  M('monthly_militarized_society', '每月军事化社会', 'internal.stability', 'decimal'),
  M('yearly_tribal_allegiance', '每年部落效忠', 'internal.stability', 'decimal'),
  M('election_cycle', '选举周期', 'internal.stability', 'integer'),
  M('candidate_random_bonus', '候选人随机加成', 'internal.stability', 'integer'),
  M('reelection_cost', '连任花费', 'internal.stability'),
  M('monthly_splendor', '每月辉煌', 'internal.stability', 'integer'),
  M('yearly_absolutism', '每年绝对主义', 'internal.stability', 'decimal'),
  M('max_absolutism', '绝对主义上限', 'internal.stability', 'integer'),
  M('max_states', '州数量上限', 'internal.stability', 'integer'),

  /* -------------------------- 内部 · 叛乱与自治 -------------------------- */
  M('global_unrest', '全局叛乱度', 'internal.unrest', 'integer'),
  M('local_unrest', '本地叛乱度', 'internal.unrest', 'integer'),
  M('years_of_nationalism', '民族主义年数', 'internal.unrest', 'integer'),
  M('local_years_of_nationalism', '本地民族主义年数', 'internal.unrest', 'integer'),
  M('global_autonomy', '全局自治度', 'internal.unrest'),
  M('local_autonomy', '本地自治度', 'internal.unrest'),
  M('min_autonomy', '最低自治度', 'internal.unrest', 'integer'),
  M('min_local_autonomy', '本地最低自治度', 'internal.unrest', 'integer'),
  M('min_autonomy_in_territories', '领地最低自治度', 'internal.unrest'),
  M('autonomy_change_time', '自治度变化时间', 'internal.unrest'),
  M('harsh_treatment_cost', '严酷镇压花费', 'internal.unrest'),

  /* ------------------------------- 内部 · 宗教 ------------------------------- */
  M('global_missionary_strength', '全国传教力量', 'internal.religion'),
  M('global_heretic_missionary_strength', '全国异端传教力量', 'internal.religion'),
  M('local_missionary_strength', '本地传教力量', 'internal.religion'),
  M('missionary_maintenance_cost', '传教维护费', 'internal.religion'),
  M('local_missionary_maintenance_cost', '本地传教维护费', 'internal.religion'),
  M('missionaries', '传教士数量', 'internal.religion', 'integer'),
  M('religious_unity', '宗教统一', 'internal.religion'),
  M('tolerance_heathen', '异教容忍', 'internal.religion', 'integer'),
  M('tolerance_heretic', '异端容忍', 'internal.religion', 'integer'),
  M('tolerance_own', '正统信仰容忍', 'internal.religion', 'integer'),
  M('papal_influence', '教廷影响', 'internal.religion', 'integer'),
  M('church_power_modifier', '教会力量', 'internal.religion'),
  M('monthly_fervor_increase', '每月狂热', 'internal.religion', 'decimal'),
  M('harmonization_speed', '和谐速度', 'internal.religion'),
  M('yearly_harmony', '每年和谐', 'internal.religion', 'decimal'),
  M('monthly_piety', '每月虔诚', 'internal.religion', 'decimal'),
  M('monthly_karma', '每月业力', 'internal.religion', 'decimal'),
  M('enforce_religion_cost', '强制宗教花费', 'internal.religion'),
  M('prestige_per_development_from_conversion', '转化发展度威望', 'internal.religion'),
  M('religious_conversion_resistance', '宗教转化抵抗', 'internal.religion'),
  M('local_religious_unity_contribution', '本地宗教统一贡献', 'internal.religion'),
  M('establish_order_cost', '建立修会花费', 'internal.religion'),

  /* ------------------------------- 内部 · 文化 ------------------------------- */
  M('culture_conversion_cost', '文化转化花费', 'internal.culture'),
  M('local_culture_conversion_cost', '本地文化转化花费', 'internal.culture'),
  M('promote_culture_cost', '推广文化花费', 'internal.culture'),
  M('num_accepted_cultures', '可接受文化数量', 'internal.culture', 'integer'),
  M('same_culture_advisor_cost', '同文化顾问花费', 'internal.culture'),

  /* ----------------------------- 其他 · 省份数值 ----------------------------- */
  M('local_manpower', '本地人力', 'misc.province'),
  M('local_manpower_modifier', '本地人力上限', 'misc.province'),
  M('local_sailors', '本地水手', 'misc.province', 'integer'),
  M('local_sailors_modifier', '本地水手上限', 'misc.province'),
  M('local_amount_of_banners', '本地八旗数量', 'misc.province'),
  M('local_has_banners', '本地拥有八旗', 'misc.province', 'integer'),
  M('local_ship_cost', '本地船只花费', 'misc.province'),
  M('local_ship_repair', '本地船只修理', 'misc.province'),
  M('local_naval_engagement_modifier', '本地海军交战宽度', 'misc.province'),

  /* ---------------------------- 其他 · 舰队与旗舰 ---------------------------- */
  M('trade_power_in_fleet_modifier', '舰队贸易竞争力', 'misc.fleet'),
  M('morale_in_fleet_modifier', '舰队士气', 'misc.fleet'),
  M('blockade_impact_on_siege_in_fleet_modifier', '舰队封锁对围城影响', 'misc.fleet'),
  M('exploration_mission_range_in_fleet_modifier', '舰队探索任务范围', 'misc.fleet', 'integer'),
  M('barrage_cost_in_fleet_modifier', '舰队炮击花费', 'misc.fleet'),
  M('naval_attrition_in_fleet_modifier', '舰队海军损耗', 'misc.fleet'),
  M('privateering_efficiency_in_fleet_modifier', '舰队私掠效率', 'misc.fleet'),
  M('prestige_from_battles_in_fleet_modifier', '舰队战斗威望', 'misc.fleet'),
  M('naval_tradition_in_fleet_modifier', '舰队海军传统', 'misc.fleet'),
  M('cannons_for_hunting_pirates_in_fleet', '舰队猎捕海盗火炮', 'misc.fleet', 'integer'),
  M('movement_speed_in_fleet_modifier', '舰队移动速度', 'misc.fleet'),
  M('flagship_durability', '旗舰耐久', 'misc.fleet', 'integer'),
  M('flagship_morale', '旗舰士气', 'misc.fleet', 'integer'),
  M('flagship_naval_engagement_modifier', '旗舰海军交战宽度', 'misc.fleet', 'integer'),
  M('flagship_landing_penalty', '旗舰登陆惩罚', 'misc.fleet', 'integer'),
  M('number_of_cannons_flagship_modifier', '旗舰火炮数量', 'misc.fleet'),
  M('naval_maintenance_flagship_modifier', '旗舰海军维护费', 'misc.fleet'),
];

/**
 * Pinyin search tokens for the most frequently used modifiers. The Chinese
 * label and the English key are always searchable; these add the extra aliases
 * players tend to type (`shiqi`, `panluan`, …).
 */
const MODIFIER_KEYWORDS: Record<string, string> = {
  land_morale: 'lujunshiqi shiqi morale',
  naval_morale: 'haijunshiqi shiqi',
  discipline: 'jilv discipline',
  combat_ability: 'zhandouli',
  global_unrest: 'panluandu panluan unrest',
  local_unrest: 'bendipanluan panluan',
  core_creation: 'zaohe hexin core',
  development_cost: 'fazhan chengben dev',
  build_cost: 'jianzhu chengben build',
  global_tax_modifier: 'quanguo shuishou tax',
  trade_efficiency: 'maoyi xiaolv trade',
  production_efficiency: 'shengchan xiaolv production',
  manpower_recovery_speed: 'renli huifu manpower',
  global_manpower: 'quanguo renli manpower',
  global_manpower_modifier: 'renli shangxian manpower',
  land_forcelimit: 'lujun shangxian forcelimit',
  naval_forcelimit: 'haijun shangxian forcelimit',
  diplomatic_reputation: 'waijiao shengyu reputation',
  improve_relation_modifier: 'gaishan guanxi relation',
  aggressive_expansion: 'qinlue kuozhang ae',
  ae_impact: 'qinlue kuozhang ae',
  stability_cost_modifier: 'wendingdu chengben stability',
  technology_cost: 'keji chengben tech',
  idea_cost: 'linian chengben idea',
  prestige: 'weiwang prestige',
  legitimacy: 'hefaxing legitimacy',
  imperial_authority: 'diguo quanwei imperial',
  tolerance_heretic: 'yiduan rongren tolerance',
  tolerance_heathen: 'yijiao rongren tolerance',
  same_culture_advisor_cost: 'tongwenhua guwen advisor',
  movement_speed: 'yidong sudu movement',
  siege_ability: 'weicheng siege',
  leader_siege: 'jiangling weicheng siege',
  artillery_power: 'paobing artillery',
  infantry_power: 'bubing infantry',
  cavalry_power: 'qibing cavalry',
  fire_damage: 'huoli fire',
  shock_damage: 'chongji shock',
  morale: 'shiqi',
};

export const MODIFIER_OPTIONS: GameOption[] = MODIFIER_DEFS.map((def) => ({
  value: def.value,
  label: def.label,
  keywords: [MODIFIER_KEYWORDS[def.value], def.label, def.value].filter(Boolean).join(' '),
  type: def.type,
  group: def.group,
}));

const MODIFIER_BY_KEY = new Map<string, ModifierDef>(MODIFIER_DEFS.map((def) => [def.value, def]));

/** Numeric unit of one modifier key; unknown keys default to percentage. */
export function modifierValueType(value: string): ModifierValueType {
  return MODIFIER_BY_KEY.get(String(value))?.type ?? 'percentage';
}

/** Reverse lookup: `global_unrest` -> 全局叛乱度. */
export function modifierLabelOf(value: string): string {
  return MODIFIER_BY_KEY.get(String(value))?.label ?? '';
}

/** Human-readable category of a modifier key: `military` -> 军事. */
export function modifierCategoryLabelOf(value: string): string {
  const group = MODIFIER_BY_KEY.get(String(value))?.group ?? '';
  const id = group.split('.')[0];
  return MODIFIER_CATEGORIES.find((cat) => cat.id === id)?.label ?? '';
}

/** Two-level tree consumed by ModifierTreeSelector. */
export const MODIFIER_TREE = MODIFIER_CATEGORIES.map((category) => ({
  id: category.id,
  label: category.label,
  groups: Object.keys(MODIFIER_GROUPS)
    .filter((group) => group.split('.')[0] === category.id)
    .map((group) => ({
      id: group.split('.')[1],
      label: MODIFIER_GROUPS[group],
      items: MODIFIER_OPTIONS.filter((option) => option.group === group),
    })),
}));


export const TRIGGER_OPTIONS: GameOption[] = [
  { value: 'owns', label: '拥有省份', keywords: 'yongyou shengfen owns province' },
  { value: 'controls', label: '控制省份', keywords: 'kongzhi shengfen controls controller province' },
  { value: 'any_neighbor_province', label: '拥有相邻省份', keywords: 'xianglin linju neighbor adjacent province' },
  { value: 'tag', label: '国家 TAG', keywords: 'guojia tag country' },
  { value: 'is_year', label: '当前年份大于等于', keywords: 'nianfen year is_year' },
  { value: 'year', label: '年份', keywords: 'nianfen year' },
  { value: 'has_country_flag', label: '拥有国家标记', keywords: 'biaozhi flag has_country_flag' },
  { value: 'religion', label: '宗教是', keywords: 'zongjiao religion' },
  { value: 'religion_group', label: '宗教组是', keywords: 'zongjiaozu religion_group' },
  { value: 'government', label: '政体是', keywords: 'zhengti government' },
  { value: 'has_regency', label: '拥有摄政', keywords: 'shezheng regency has_regency' },
  { value: 'legitimacy', label: '合法性', keywords: 'hefaxing legitimacy' },
  { value: 'prestige', label: '威望', keywords: 'weiwang prestige' },
  { value: 'treasury', label: '国库金币', keywords: 'guoku jinbi treasury gold' },
  { value: 'stability', label: '稳定度', keywords: 'wendingdu stability' },
  { value: 'inflation', label: '通货膨胀', keywords: 'tonghuo inflation' },
  { value: 'corruption', label: '腐败度', keywords: 'fubai corruption' },
  { value: 'num_of_cities', label: '城市数量', keywords: 'chengshi num_of_cities' },
  { value: 'num_of_provinces', label: '省份数量', keywords: 'shengfen num_of_provinces' },
  { value: 'manpower', label: '人力', keywords: 'renli manpower' },
  { value: 'army_size', label: '陆军规模', keywords: 'lujun army_size' },
  { value: 'navy_size', label: '海军规模', keywords: 'haijun navy_size' },
  { value: 'adm_tech', label: '行政科技', keywords: 'xingzheng keji adm_tech' },
  { value: 'dip_tech', label: '外交科技', keywords: 'waijiao keji dip_tech' },
  { value: 'mil_tech', label: '军事科技', keywords: 'junshi keji mil_tech' },
  { value: 'is_emperor', label: '是神罗皇帝', keywords: 'shenluo huangdi emperor' },
  { value: 'is_subject', label: '是附属国', keywords: 'fushuguo subject' },
  { value: 'overlord', label: '宗主国是', keywords: 'zongzhuguo overlord' },
  { value: 'at_war', label: '处于战争', keywords: 'zhanzheng at_war' },
  { value: 'truce_with', label: '与某国停战', keywords: 'tingzhan truce' },
  { value: 'alliance_with', label: '与某国同盟', keywords: 'tongmeng alliance' },
  { value: 'has_casus_belli', label: '拥有宣战理由', keywords: 'xuanzhan casus_belli' },
  { value: 'has_idea', label: '拥有理念', keywords: 'linian idea' },
  { value: 'has_idea_group', label: '拥有理念组', keywords: 'liniangzu idea_group' },
  { value: 'culture', label: '文化是', keywords: 'wenhua culture' },
  { value: 'primary_culture', label: '主流文化是', keywords: 'zhuliu primary_culture' },
  { value: 'technology_group', label: '科技组是', keywords: 'kejizu technology_group' },
  { value: 'exists', label: '国家存在', keywords: 'cunzai exists' },
  { value: 'custom', label: '自定义脚本', keywords: 'zidingyi custom script' },
];

const BASE_EFFECT_OPTIONS: GameOption[] = [
  { value: 'add_prestige', label: '增加威望', keywords: 'zengjia weiwang prestige' },
  { value: 'add_stability', label: '增加稳定度', keywords: 'wendingdu stability' },
  { value: 'add_legitimacy', label: '增加合法性', keywords: 'hefaxing legitimacy' },
  { value: 'add_adm_power', label: '增加行政点数', keywords: 'xingzheng dian add_adm_power' },
  { value: 'add_dip_power', label: '增加外交点数', keywords: 'waijiao dian add_dip_power' },
  { value: 'add_mil_power', label: '增加军事点数', keywords: 'junshi dian add_mil_power' },
  { value: 'add_treasury', label: '增加金币', keywords: 'jinbi treasury gold' },
  { value: 'add_manpower', label: '增加人力', keywords: 'renli manpower' },
  { value: 'add_sailors', label: '增加水手', keywords: 'shuishou sailors' },
  { value: 'add_army_tradition', label: '增加陆军传统', keywords: 'lujun chuantong army_tradition' },
  { value: 'add_navy_tradition', label: '增加海军传统', keywords: 'haijun chuantong navy_tradition' },
  { value: 'add_republican_tradition', label: '增加共和传统', keywords: 'gonghe chuantong republican_tradition' },
  { value: 'add_devotion', label: '增加虔诚', keywords: 'qiancheng devotion' },
  { value: 'add_mercantilism', label: '增加重商主义', keywords: 'zhongshang mercantilism' },
  { value: 'add_inflation', label: '增加通胀', keywords: 'tonghuo inflation' },
  { value: 'add_corruption', label: '增加腐败', keywords: 'fubai corruption' },
  { value: 'add_war_exhaustion', label: '增加战争疲劳', keywords: 'zhanzheng pila war_exhaustion' },
  { value: 'add_years_of_income', label: '获得年收入', keywords: 'nianshouru years_of_income' },
  { value: 'add_country_modifier', label: '添加国家修正', keywords: 'guojia xiuzheng country_modifier' },
  { value: 'add_core', label: '添加核心', keywords: 'hexin add_core' },
  { value: 'add_claim', label: '添加宣称', keywords: 'xuancheng claim' },
  { value: 'add_casus_belli', label: '添加宣战理由', keywords: 'xuanzhan casus_belli' },
  { value: 'add_loan', label: '添加贷款', keywords: 'daikuan loan' },
  { value: 'create_advisor', label: '创建顾问', keywords: 'guwen advisor' },
  { value: 'create_general', label: '创建陆军将领', keywords: 'jiangling general' },
  { value: 'create_admiral', label: '创建海军将领', keywords: 'haijun jiangling admiral' },
  { value: 'change_religion', label: '改变宗教', keywords: 'zongjiao religion' },
  { value: 'add_government_reform_progress', label: '增加政改进度', keywords: 'zhengti gaige reform' },
  { value: 'add_reform_desire', label: '增加改革意愿', keywords: 'gaige yiyuan reform_desire' },
  { value: 'add_papal_influence', label: '增加教廷影响', keywords: 'jiaoting papal' },
  { value: 'add_imperial_authority', label: '增加帝国权威', keywords: 'diguo quanwei imperial' },
  { value: 'add_splendor', label: '增加辉煌点数', keywords: 'huihuang splendor' },
  { value: 'add_absolutism', label: '增加专制主义', keywords: 'zhuanzhi absolutism' },
  { value: 'country_event', label: '触发国家事件', keywords: 'chufa shijian country_event' },
  { value: 'custom', label: '自定义脚本', keywords: 'zidingyi custom script' },
];

/**
 * Effects use flat integer values (add_prestige = 20, add_stability = 1).
 * The `type` is part of the dictionary contract consumed by the UI converter.
 */
export const EFFECT_OPTIONS: GameOption[] = BASE_EFFECT_OPTIONS.map((option) => ({
  ...option,
  type: 'integer' as const,
}));

/* MODIFIER_OPTIONS / MODIFIER_TREE are defined above from MODIFIER_DEFS. */

export const CATEGORY_OPTIONS: GameOption[] = [  { value: 'decision', label: '国家决议', keywords: 'guojia jueyi decision' },
  { value: 'DHE', label: '动态历史事件', keywords: 'dongtai lishi shijian DHE' },
  { value: 'is_regular', label: '常规事件', keywords: 'changgui shijian regular' },
  { value: 'fire_only_once', label: '仅触发一次', keywords: 'jin chufa yici once' },
  { value: 'major', label: '重大事件', keywords: 'zhongda shijian major' },
  { value: 'is_triggered_only', label: '仅由脚本触发', keywords: 'jiaoben chufa triggered' },
  { value: 'hidden', label: '隐藏事件', keywords: 'yincang shijian hidden' },
  { value: 'news', label: '新闻事件', keywords: 'xinwen news' },
  { value: 'country_event', label: '国家事件', keywords: 'guojia shijian country' },
  { value: 'province_event', label: '省份事件', keywords: 'shengfen shijian province' },
  { value: 'flavor', label: '风味事件', keywords: 'fengwei shijian flavor' },
  { value: 'historical', label: '历史事件', keywords: 'lishi shijian historical' },
  { value: 'random', label: '随机事件', keywords: 'suiji shijian random' },
  { value: 'pulse', label: '脉冲事件', keywords: 'maichong shijian pulse' },
  { value: 'event', label: '事件', keywords: 'shijian event' },
  { value: 'decision', label: '决议', keywords: 'jueyi decision' },
  { value: 'mission', label: '任务', keywords: 'renwu mission' },
  { value: 'disaster', label: '灾难', keywords: 'zainan disaster' },
  { value: 'estate', label: '阶层', keywords: 'jieceng estate' },
  { value: 'parliament', label: '议会', keywords: 'yihui parliament' },
  { value: 'reform', label: '改革', keywords: 'gaige reform' },
  { value: 'government', label: '政体', keywords: 'zhengti government' },
  { value: 'idea', label: '理念', keywords: 'linian idea' },
  { value: 'policy', label: '政策', keywords: 'zhengce policy' },
  { value: 'unit', label: '兵种', keywords: 'bingzhong unit' },
  { value: 'building', label: '建筑', keywords: 'jianzhu building' },
  { value: 'trade_good', label: '贸易商品', keywords: 'maoyi shangpin trade_good' },
  { value: 'religion', label: '宗教', keywords: 'zongjiao religion' },
  { value: 'culture', label: '文化', keywords: 'wenhua culture' },
  { value: 'technology', label: '科技', keywords: 'keji technology' },
];

export type GUIAnchorCode = (typeof GUI_ANCHORS)[number]['value'];
export type GUIVisibilityCode = (typeof GUI_VISIBILITIES)[number]['value'];

/** Look up the Chinese label for an anchor code (fallback: the code itself). */
export const PROVINCE_FIELD_OPTIONS: GameOption[] = [
  { value: 'owner', label: '所有者', keywords: 'suoyouzhe owner' },
  { value: 'controller', label: '控制者', keywords: 'kongzhizhe controller' },
  { value: 'add_core', label: '添加核心', keywords: 'hexin add_core' },
  { value: 'remove_core', label: '移除核心', keywords: 'hexin remove_core' },
  { value: 'base_tax', label: '基础税收', keywords: 'shuishou base_tax tax' },
  { value: 'base_production', label: '基础生产', keywords: 'shengchan base_production production' },
  { value: 'base_manpower', label: '基础人力', keywords: 'renli base_manpower manpower' },
  { value: 'culture', label: '文化', keywords: 'wenhua culture' },
  { value: 'religion', label: '宗教', keywords: 'zongjiao religion' },
  { value: 'trade_goods', label: '贸易商品', keywords: 'maoyi shangpin trade_goods' },
  { value: 'capital', label: '首都', keywords: 'shoudu capital' },
];

export const COUNTRY_FIELD_OPTIONS: GameOption[] = [
  { value: 'capital', label: '首都省份 ID', keywords: 'shoudu capital' },
  { value: 'government', label: '政体', keywords: 'zhengti government' },
  { value: 'technology_group', label: '科技组', keywords: 'kejizu technology_group' },
  { value: 'primary_culture', label: '主流文化', keywords: 'zhuliu wenhua primary_culture' },
  { value: 'religion', label: '宗教', keywords: 'zongjiao religion' },
  { value: 'add_monarch', label: '添加君主', keywords: 'junzhu monarch add_monarch' },
  { value: 'name', label: '国家名称', keywords: 'guojia mingcheng name' },
  { value: 'localisation', label: '本地化名称', keywords: 'bendihua localisation' },
];

export const TECH_GROUP_OPTIONS: GameOption[] = [
  { value: 'western', label: '西欧', keywords: 'xiou western' },
  { value: 'eastern', label: '东欧', keywords: 'dongou eastern' },
  { value: 'ottoman', label: '奥斯曼', keywords: 'aosiman ottoman' },
  { value: 'muslim', label: '穆斯林', keywords: 'musilin muslim' },
  { value: 'chinese', label: '中华', keywords: 'zhonghua chinese' },
  { value: 'indian', label: '印度', keywords: 'yindu indian' },
  { value: 'nomad', label: '游牧', keywords: 'youmu nomad' },
  { value: 'sub_saharan', label: '撒哈拉以南', keywords: 'sahala sub_saharan' },
  { value: 'andean', label: '安第斯', keywords: 'andisi andean' },
  { value: 'mesoamerican', label: '中美洲', keywords: 'zhongmeizhou mesoamerican' },
  { value: 'north_american', label: '北美原住民', keywords: 'beimei north_american' },
  { value: 'south_american', label: '南美原住民', keywords: 'nanmei south_american' },
  { value: 'aboriginal', label: '澳洲原住民', keywords: 'aozhou aboriginal' },
  { value: 'high_american', label: '高等美洲', keywords: 'gaodeng high_american' },
];

export const GOVERNMENT_OPTIONS: GameOption[] = [
  { value: 'monarchy', label: '君主制', keywords: 'junzhuzhi monarchy' },
  { value: 'feudal_monarchy', label: '封建君主制', keywords: 'fengjian monarchy' },
  { value: 'administrative_monarchy', label: '行政君主制', keywords: 'xingzheng monarchy' },
  { value: 'despotic_monarchy', label: '专制君主制', keywords: 'zhuanzhi monarchy' },
  { value: 'elective_monarchy', label: '选举君主制', keywords: 'xuanju monarchy' },
  { value: 'constitutional_monarchy', label: '君主立宪', keywords: 'lixian monarchy' },
  { value: 'absolute_monarchy', label: '绝对君主制', keywords: 'juedui monarchy' },
  { value: 'enlightened_despotism', label: '开明专制', keywords: 'kaiming despotism' },
  { value: 'republic', label: '共和制', keywords: 'gonghezhi republic' },
  { value: 'merchant_republic', label: '商业共和', keywords: 'shangye republic' },
  { value: 'noble_republic', label: '贵族共和', keywords: 'guizu republic' },
  { value: 'oligarchic_republic', label: '寡头共和', keywords: 'guatou republic' },
  { value: 'administrative_republic', label: '行政共和', keywords: 'xingzheng republic' },
  { value: 'democratic_republic', label: '民主共和', keywords: 'minzhu republic' },
  { value: 'federal_republic', label: '联邦共和', keywords: 'lianbang republic' },
  { value: 'revolutionary_republic', label: '革命共和', keywords: 'geming republic' },
  { value: 'theocracy', label: '神权制', keywords: 'shenquan theocracy' },
  { value: 'hussite_theocracy', label: '胡斯神权', keywords: 'husi hussite theocracy' },
  { value: 'papal_state', label: '教宗国', keywords: 'jiaozong papal' },
  { value: 'monastic_order', label: '修道会', keywords: 'xiudaohui monastic' },
  { value: 'horde', label: '草原游牧', keywords: 'caoyuan horde' },
  { value: 'tribal', label: '部落', keywords: 'buluo tribal' },
  { value: 'native_council', label: '原住民议会', keywords: 'yuanzhumin council' },
  { value: 'siberian_clan', label: '西伯利亚氏族', keywords: 'xiboliya clan' },
  { value: 'pirate_republic', label: '海盗共和', keywords: 'haidao pirate' },
];

export const RELIGION_OPTIONS: GameOption[] = [
  { value: 'catholic', label: '天主教', keywords: 'tianzhujiao catholic' },
  { value: 'protestant', label: '新教', keywords: 'xinjiao protestant' },
  { value: 'reformed', label: '归正宗', keywords: 'guizheng reformed' },
  { value: 'orthodox', label: '东正教', keywords: 'dongzhengjiao orthodox' },
  { value: 'coptic', label: '科普特', keywords: 'kepute coptic' },
  { value: 'hussite', label: '胡斯信仰', keywords: 'husi hussite' },
  { value: 'jewish', label: '犹太教', keywords: 'youtai jewish' },
  { value: 'sunni', label: '逊尼派', keywords: 'xunni sunni' },
  { value: 'shiite', label: '什叶派', keywords: 'shiye shiite' },
  { value: 'ibadi', label: '伊巴德派', keywords: 'yibade ibadi' },
  { value: 'animist', label: '泛灵论', keywords: 'fanling animist' },
  { value: 'shamanist', label: '萨满教', keywords: 'saman shamanist' },
  { value: 'totemist', label: '图腾崇拜', keywords: 'tuteng totemist' },
  { value: 'norse_pagan', label: '北欧多神教', keywords: 'beiou norse' },
  { value: 'tengri_pagan', label: '腾格里', keywords: 'tengeli tengri' },
  { value: 'buddhist', label: '佛教', keywords: 'fojiao buddhist' },
  { value: 'confucian', label: '儒教', keywords: 'rujiao confucian' },
  { value: 'shinto', label: '神道教', keywords: 'shendao shinto' },
  { value: 'hindu', label: '印度教', keywords: 'yindu hindu' },
  { value: 'sikh', label: '锡克教', keywords: 'xike sikh' },
  { value: 'zoroastrian', label: '琐罗亚斯德教', keywords: 'suoluo zoroastrian' },
  { value: 'maya', label: '玛雅宗教', keywords: 'maya' },
  { value: 'aztec', label: '阿兹特克宗教', keywords: 'aztec' },
  { value: 'inti', label: '印加宗教', keywords: 'inka inti' },
];

export { CULTURE_OPTIONS, CULTURE_GROUPS } from './cultures-data.js';
export type { CultureEntry, CultureGroupData } from './cultures-data.js';

export function anchorLabel(value: string): string {
  return GUI_ANCHORS.find((option) => option.value === value)?.label || value;
}

/** Look up the Chinese label for a visibility code (fallback: the code itself). */
export function visibilityLabel(value: string): string {
  return GUI_VISIBILITIES.find((option) => option.value === value)?.label || value;
}
