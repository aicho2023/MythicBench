// The report's reference list: only works the report's argument rests on, or
// whose method it uses. Every entry was checked against its source on
// 2026-11-24 (title, authors, year, venue, link): arXiv's own records for the
// preprints, OpenReview for the venues, and the DOI registry for the journals.
// Years are the year of the venue that published the paper, or of the arXiv
// preprint if it has none.

export interface Ref {
  key: string
  /** in-text form, "Shinn et al., 2023" */
  cite: string
  /** full reference, author-year style */
  full: string
  url: string
}

export const REFS: Ref[] = [
  // Agents scored on one attempt
  { key: 'swebench', cite: 'Jimenez et al., 2024', full: 'Jimenez, C. E., et al. (2024). SWE-bench: Can Language Models Resolve Real-World GitHub Issues? ICLR 2024.', url: 'https://arxiv.org/abs/2310.06770' },
  { key: 'webarena', cite: 'Zhou et al., 2024', full: 'Zhou, S., et al. (2024). WebArena: A Realistic Web Environment for Building Autonomous Agents. ICLR 2024.', url: 'https://arxiv.org/abs/2307.13854' },
  { key: 'vending-bench', cite: 'Backlund & Petersson, 2025', full: 'Backlund, A., & Petersson, L. (2025). Vending-Bench: A Benchmark for Long-Term Coherence of Autonomous Agents. arXiv:2502.15840.', url: 'https://arxiv.org/abs/2502.15840' },

  // Learning across attempts
  { key: 'reflexion', cite: 'Shinn et al., 2023', full: 'Shinn, N., et al. (2023). Reflexion: Language Agents with Verbal Reinforcement Learning. NeurIPS 2023.', url: 'https://arxiv.org/abs/2303.11366' },
  { key: 'expel', cite: 'Zhao et al., 2024', full: 'Zhao, A., et al. (2024). ExpeL: LLM Agents Are Experiential Learners. AAAI 2024.', url: 'https://arxiv.org/abs/2308.10144' },
  { key: 'no-self-correct', cite: 'Huang et al., 2024', full: 'Huang, J., et al. (2024). Large Language Models Cannot Self-Correct Reasoning Yet. ICLR 2024.', url: 'https://arxiv.org/abs/2310.01798' },
  { key: 'evotest', cite: 'He et al., 2026', full: 'He, Y., et al. (2026). EvoTest: Evolutionary Test-Time Learning for Self-Improving Agentic Systems. ICLR 2026.', url: 'https://arxiv.org/abs/2510.13220' },

  // Games and teams
  { key: 'balrog', cite: 'Paglieri et al., 2025', full: 'Paglieri, D., et al. (2025). BALROG: Benchmarking Agentic LLM and VLM Reasoning On Games. ICLR 2025.', url: 'https://arxiv.org/abs/2411.13543' },
  { key: 'arc-agi-3', cite: 'ARC Prize Foundation, 2026', full: 'ARC Prize Foundation (2026). ARC-AGI-3: A New Challenge for Frontier Agentic Intelligence. arXiv:2603.24621.', url: 'https://arxiv.org/abs/2603.24621' },
  { key: 'hanabi', cite: 'Bard et al., 2020', full: 'Bard, N., et al. (2020). The Hanabi Challenge: A New Frontier for AI Research. Artificial Intelligence, 280, 103216.', url: 'https://doi.org/10.1016/j.artint.2019.103216' },
  { key: 'overcooked-ai', cite: 'Carroll et al., 2019', full: 'Carroll, M., et al. (2019). On the Utility of Learning about Humans for Human-AI Coordination. NeurIPS 2019.', url: 'https://arxiv.org/abs/1910.05789' },
  { key: 'mast', cite: 'Cemri et al., 2025', full: 'Cemri, M., et al. (2025). Why Do Multi-Agent LLM Systems Fail? NeurIPS 2025 Datasets and Benchmarks Track.', url: 'https://arxiv.org/abs/2503.13657' },
  { key: 'clocktower-bench', cite: 'Patel, 2026', full: 'Patel, D. (2026, November 5). The benchmark where AIs have to lie to win. dwarkesh.com.', url: 'https://www.dwarkesh.com/p/clocktower' },

  // Statistics
  { key: 'holm', cite: 'Holm, 1979', full: 'Holm, S. (1979). A Simple Sequentially Rejective Multiple Test Procedure. Scandinavian Journal of Statistics, 6(2), 65–70.', url: 'https://www.jstor.org/stable/4615733' },
  { key: 'clopper-pearson', cite: 'Clopper & Pearson, 1934', full: 'Clopper, C. J., & Pearson, E. S. (1934). The use of confidence or fiducial limits illustrated in the case of the binomial. Biometrika, 26(4), 404–413.', url: 'https://doi.org/10.1093/biomet/26.4.404' },
  { key: 'error-bars', cite: 'Miller, 2024', full: 'Miller, E. (2024). Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations. arXiv:2411.00640.', url: 'https://arxiv.org/abs/2411.00640' },
]
