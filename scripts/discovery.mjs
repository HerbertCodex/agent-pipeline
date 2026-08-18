/**
 * Les questions qui font comprendre un projet avant d'en choisir la forme.
 *
 * Elles se repondent en langue ordinaire, sans vocabulaire technique, parce
 * que celui qui connait le produit n'est pas forcement celui qui connait
 * les architectures. Une recommandation donnee sans ces reponses est un
 * catalogue : elle ne peut argumenter que dans l'abstrait.
 */
export const BRIEF_QUESTIONS = [
  {
    id: "B1",
    question: "En une phrase, a quoi sert le produit et pour qui ?",
    hint: "Sans jargon. Si la phrase a besoin d'un mot technique, c'est qu'elle decrit la solution et pas le besoin.",
    reveals: "le domaine, et si le produit a un utilisateur identifiable",
  },
  {
    id: "B2",
    question: "Citez trois choses qu'un utilisateur fait avec.",
    hint: "Des gestes, pas des ecrans. « emprunter un livre », pas « la page emprunt ».",
    reveals: "les operations reelles, et si elles sont plus que du stockage",
  },
  {
    id: "B3",
    question: "Y a-t-il des situations ou le systeme doit REFUSER quelque chose ? Lesquelles ?",
    hint: "Pas les champs obligatoires ni les formats. De vrais refus : « ce livre est deja sorti », « ce compte n'a pas assez ».",
    reveals: "LA question qui detecte le metier. Aucun refus de ce genre, aucun metier.",
  },
  {
    id: "B4",
    question: "Ces refus, un professionnel du metier les comprendrait-il sans qu'on parle informatique ?",
    hint: "Un bibliothecaire, un comptable. S'il hoche la tete, c'est du metier. S'il ne voit pas pourquoi vous lui dites ca, c'est de la saisie.",
    reveals: "si les refus sont des regles metier ou de la validation deguisee",
  },
  {
    id: "B5",
    question: "Le produit parle-t-il a des systemes exterieurs ? Pourriez-vous en changer un jour ?",
    hint: "Base de donnees, paiement, envoi de courriel, service tiers. Et surtout : lequel changerez-vous VRAIMENT.",
    reveals: "si des ports se justifient, ou si ce serait une assurance jamais utilisee",
  },
  {
    id: "B6",
    question: "Combien de personnes ou d'agents travailleront dessus en meme temps ?",
    hint: "Compte les agents du pipeline comme des personnes : ils se marchent dessus de la meme maniere.",
    reveals: "si le rangement doit optimiser la coherence ou le travail parallele",
  },
  {
    id: "B7",
    question: "Dans vos projets precedents, qu'est-ce qui a change le plus souvent ?",
    hint: "Les ecrans, les regles, les integrations. Repondez sur l'experience, pas sur l'intention.",
    reveals: "ce qu'il faut placer au centre, et ce qu'il faut laisser en peripherie",
  },
  {
    id: "B8",
    question: "Qu'est-ce que le produit ne fera PAS ?",
    hint: "Ce qui n'est pas nomme est suppose fait. C'est vrai des la premiere conversation.",
    reveals: "le perimetre reel, et souvent une regle metier cachee dans une exclusion",
  },
];

/**
 * Verdicts possibles d'une architecture face a un projet analyse.
 */
const VERDICT = {
  recommande: { label: "Recommandé", rank: 0 },
  possible: { label: "Possible", rank: 1 },
  excessif: { label: "Excessif ici", rank: 2 },
};

/**
 * Confronte une architecture a l'analyse d'un projet.
 *
 * Le raisonnement est explicite et rendu a l'operateur : une recommandation
 * dont on ne voit pas le motif ne se discute pas, elle s'accepte — ce qui
 * est exactement ce que ce mecanisme existe pour empecher.
 *
 * @param entry - architecture du catalogue
 * @param analysis - analyse du projet issue du cahier des charges
 * @returns le verdict et les raisons qui le fondent
 */
export function judge(entry, analysis) {
  const rules = (analysis.business_rules ?? []).length;
  const swappable = (analysis.integrations ?? []).filter((item) => item.replaceable === true).length;
  const parallel = analysis.concurrent_workers === "few" || analysis.concurrent_workers === "teams";
  const reasons = [];
  let verdict = "possible";

  if (entry.id === "feature-modules") {
    verdict = "recommande";
    reasons.push(parallel ? `${analysis.concurrent_workers === "teams" ? "Plusieurs equipes" : "Plusieurs intervenants"} en parallele : chacun son dossier, personne ne se croise.` : "Cout quasi nul, et rien n'oblige a en sortir tant qu'une douleur precise ne l'exige pas.");
    if (rules > 0) reasons.push(`${rules} regle(s) metier reperee(s) : elles tiennent dans le dossier de leur fonctionnalite tant qu'elles ne sont pas partagees.`);
  }

  if (entry.id === "layered") {
    if (parallel) {
      verdict = "excessif";
      reasons.push("Chaque fonctionnalite traverse les trois dossiers : a plusieurs, tout le monde edite les memes endroits.");
    } else {
      reasons.push("Lisible a une personne, et familier.");
    }
  }

  if (entry.id === "hexagonal") {
    if (swappable === 0) {
      verdict = "excessif";
      reasons.push("Aucune integration declaree remplacable : les ports seraient une assurance dont vous n'encaisserez jamais l'interet.");
    } else if (swappable >= 2) {
      verdict = "recommande";
      reasons.push(`${swappable} integrations que vous comptez pouvoir changer : c'est exactement le probleme que l'hexagonale resout.`);
    } else {
      reasons.push("Une seule integration remplacable : isolez celle-la, pas tout le reste.");
    }
  }

  if (entry.id === "clean" || entry.id === "onion") {
    if (rules === 0) {
      verdict = "excessif";
      reasons.push("Aucune regle metier reperee : les couches se rempliraient d'objets qui recopient des lignes.");
    } else if (rules >= 8) {
      verdict = "recommande";
      reasons.push(`${rules} regles metier : assez dense pour justifier de les isoler de toute technologie.`);
    } else {
      verdict = "excessif";
      reasons.push(`${rules} regle(s) metier : c'est un invariant a proteger, pas un domaine a isoler. Protegez-le au bon endroit plutot que d'ajouter des couches.`);
    }
  }

  if (entry.id === "feature-sliced") {
    verdict = parallel ? "recommande" : "possible";
    reasons.push("Empeche les imports circulaires dans une base ou tout tend a tout importer.");
  }

  if (entry.id === "mvvm") {
    reasons.push("La logique d'ecran se teste sans lancer l'interface.");
  }

  if (entry.id === "mvi") {
    verdict = analysis.expected_churn === "screens" ? "possible" : "excessif";
    reasons.push(analysis.expected_churn === "screens" ? "Les ecrans bougent souvent : un etat reproductible se rentabilise." : "Sans etat d'ecran complique, la machinerie coute plus cher que ce qu'elle protege.");
  }

  return { verdict, label: VERDICT[verdict].label, rank: VERDICT[verdict].rank, reasons };
}

/**
 * Resume ce que l'analyse dit du projet, en une phrase opposable.
 *
 * @param analysis - analyse du projet
 * @returns la phrase de synthese
 */
export function summarise(analysis) {
  const rules = (analysis.business_rules ?? []).length;
  const swappable = (analysis.integrations ?? []).filter((item) => item.replaceable === true).length;
  const domain = rules === 0 ? "aucune regle metier" : rules < 8 ? `${rules} regle(s) metier a proteger` : `${rules} regles metier, un domaine dense`;
  const ports = swappable === 0 ? "aucune integration a remplacer" : `${swappable} integration(s) remplacable(s)`;
  return `${domain}, ${ports}, ${analysis.concurrent_workers === "one" ? "un seul intervenant" : analysis.concurrent_workers === "teams" ? "plusieurs equipes" : "quelques intervenants en parallele"}.`;
}
