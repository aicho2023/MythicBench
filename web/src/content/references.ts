// The report's reference list. Every entry was checked against its source
// (title, authors, year, link) before it was added. Years are the year of the
// venue that published the paper, or of the arXiv preprint if it has none.

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
  { key: 'osworld', cite: 'Xie et al., 2024', full: 'Xie, T., et al. (2024). OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments. NeurIPS 2024 Datasets and Benchmarks.', url: 'https://arxiv.org/abs/2404.07972' },
  { key: 'agentbench', cite: 'Liu et al., 2024', full: 'Liu, X., et al. (2024). AgentBench: Evaluating LLMs as Agents. ICLR 2024.', url: 'https://arxiv.org/abs/2308.03688' },
  { key: 'metr-horizon', cite: 'Kwa et al., 2025', full: 'Kwa, T., et al. (2025). Measuring AI Ability to Complete Long Tasks. arXiv:2503.14499.', url: 'https://arxiv.org/abs/2503.14499' },
  { key: 'vending-bench', cite: 'Backlund & Petersson, 2025', full: 'Backlund, A., & Petersson, L. (2025). Vending-Bench: A Benchmark for Long-Term Coherence of Autonomous Agents. arXiv:2502.15840.', url: 'https://arxiv.org/abs/2502.15840' },
  { key: 'hle', cite: 'Phan et al., 2025', full: "Phan, L., et al. (2025). Humanity's Last Exam. arXiv:2501.14249.", url: 'https://arxiv.org/abs/2501.14249' },

  // Learning across attempts
  { key: 'reflexion', cite: 'Shinn et al., 2023', full: 'Shinn, N., et al. (2023). Reflexion: Language Agents with Verbal Reinforcement Learning. NeurIPS 2023.', url: 'https://arxiv.org/abs/2303.11366' },
  { key: 'expel', cite: 'Zhao et al., 2024', full: 'Zhao, A., et al. (2024). ExpeL: LLM Agents Are Experiential Learners. AAAI 2024.', url: 'https://arxiv.org/abs/2308.10144' },
  { key: 'no-self-correct', cite: 'Huang et al., 2024', full: 'Huang, J., et al. (2024). Large Language Models Cannot Self-Correct Reasoning Yet. ICLR 2024.', url: 'https://arxiv.org/abs/2310.01798' },
  { key: 'algorithm-distillation', cite: 'Laskin et al., 2023', full: 'Laskin, M., et al. (2023). In-context Reinforcement Learning with Algorithm Distillation. ICLR 2023.', url: 'https://arxiv.org/abs/2210.14215' },
  { key: 'evotest', cite: 'He et al., 2026', full: 'He, Y., et al. (2026). EvoTest: Evolutionary Test-Time Learning for Self-Improving Agentic Systems. ICLR 2026.', url: 'https://arxiv.org/abs/2510.13220' },

  // Games
  { key: 'textworld', cite: 'Côté et al., 2018', full: 'Côté, M.-A., et al. (2018). TextWorld: A Learning Environment for Text-based Games. arXiv:1806.11532.', url: 'https://arxiv.org/abs/1806.11532' },
  { key: 'nle', cite: 'Küttler et al., 2020', full: 'Küttler, H., et al. (2020). The NetHack Learning Environment. NeurIPS 2020.', url: 'https://arxiv.org/abs/2006.13760' },
  { key: 'balrog', cite: 'Paglieri et al., 2025', full: 'Paglieri, D., et al. (2025). BALROG: Benchmarking Agentic LLM and VLM Reasoning On Games. ICLR 2025.', url: 'https://arxiv.org/abs/2411.13543' },
  { key: 'smartplay', cite: 'Wu et al., 2024', full: 'Wu, Y., Tang, X., Mitchell, T., & Li, Y. (2024). SmartPlay: A Benchmark for LLMs as Intelligent Agents. ICLR 2024.', url: 'https://arxiv.org/abs/2310.01557' },
  { key: 'voyager', cite: 'Wang et al., 2023', full: 'Wang, G., et al. (2023). Voyager: An Open-Ended Embodied Agent with Large Language Models. arXiv:2305.16291.', url: 'https://arxiv.org/abs/2305.16291' },
  { key: 'cradle', cite: 'Tan et al., 2025', full: 'Tan, W., et al. (2025). Cradle: Empowering Foundation Agents Towards General Computer Control. ICML 2025.', url: 'https://arxiv.org/abs/2403.03186' },
  { key: 'videogamebench', cite: 'Zhang et al., 2025', full: 'Zhang, A. L., Griffiths, T. L., Narasimhan, K. R., & Press, O. (2025). VideoGameBench: Can Vision-Language Models Complete Popular Video Games? arXiv:2505.18134.', url: 'https://arxiv.org/abs/2505.18134' },
  { key: 'claude-pokemon', cite: 'Anthropic, 2025', full: "Anthropic (2025). Claude's extended thinking (section “Claude plays Pokémon”). Anthropic News, 24 February 2025.", url: 'https://www.anthropic.com/news/visible-extended-thinking' },
  { key: 'gemini-pokemon', cite: 'Comanici et al., 2025', full: 'Comanici, G., et al. (2025). Gemini 2.5: Pushing the Frontier with Advanced Reasoning, Multimodality, Long Context, and Next Generation Agentic Capabilities. arXiv:2507.06261.', url: 'https://arxiv.org/abs/2507.06261' },
  { key: 'arc-agi-3', cite: 'ARC Prize Foundation, 2026', full: 'ARC Prize Foundation (2026). ARC-AGI-3: A New Challenge for Frontier Agentic Intelligence. arXiv:2603.24621.', url: 'https://arxiv.org/abs/2603.24621' },
  { key: 'openai-five', cite: 'Berner et al., 2019', full: 'Berner, C., et al. (2019). Dota 2 with Large Scale Deep Reinforcement Learning. arXiv:1912.06680.', url: 'https://arxiv.org/abs/1912.06680' },
  { key: 'alphastar', cite: 'Vinyals et al., 2019', full: 'Vinyals, O., et al. (2019). Grandmaster level in StarCraft II using multi-agent reinforcement learning. Nature, 575, 350–354.', url: 'https://doi.org/10.1038/s41586-019-1724-z' },

  // Teams of agents
  { key: 'hanabi', cite: 'Bard et al., 2020', full: 'Bard, N., et al. (2020). The Hanabi Challenge: A New Frontier for AI Research. Artificial Intelligence, 280, 103216.', url: 'https://doi.org/10.1016/j.artint.2019.103216' },
  { key: 'overcooked-ai', cite: 'Carroll et al., 2019', full: 'Carroll, M., et al. (2019). On the Utility of Learning about Humans for Human-AI Coordination. NeurIPS 2019.', url: 'https://arxiv.org/abs/1910.05789' },
  { key: 'collab-overcooked', cite: 'Sun et al., 2025', full: 'Sun, H., et al. (2025). Collab-Overcooked: Benchmarking and Evaluating Large Language Models as Collaborative Agents. EMNLP 2025.', url: 'https://arxiv.org/abs/2502.20073' },
  { key: 'llm-coordination', cite: 'Agashe et al., 2023', full: 'Agashe, S., Fan, Y., Reyna, A., & Wang, X. E. (2023). LLM-Coordination: Evaluating and Analyzing Multi-agent Coordination Abilities in Large Language Models. arXiv:2310.03903.', url: 'https://arxiv.org/abs/2310.03903' },
  { key: 'mindagent', cite: 'Gong et al., 2023', full: 'Gong, R., et al. (2023). MindAgent: Emergent Gaming Interaction. arXiv:2309.09971.', url: 'https://arxiv.org/abs/2309.09971' },
  { key: 'generative-agents', cite: 'Park et al., 2023', full: 'Park, J. S., et al. (2023). Generative Agents: Interactive Simulacra of Human Behavior. UIST 2023.', url: 'https://arxiv.org/abs/2304.03442' },
  { key: 'debate', cite: 'Du et al., 2024', full: 'Du, Y., Li, S., Torralba, A., Tenenbaum, J. B., & Mordatch, I. (2024). Improving Factuality and Reasoning in Language Models through Multiagent Debate. ICML 2024.', url: 'https://arxiv.org/abs/2305.14325' },
  { key: 'mast', cite: 'Cemri et al., 2025', full: 'Cemri, M., et al. (2025). Why Do Multi-Agent LLM Systems Fail? NeurIPS 2025 Datasets and Benchmarks.', url: 'https://arxiv.org/abs/2503.13657' },
  { key: 'cicero', cite: 'Meta FAIR Diplomacy Team et al., 2022', full: 'Meta Fundamental AI Research Diplomacy Team (FAIR), Bakhtin, A., et al. (2022). Human-level play in the game of Diplomacy by combining language models with strategic reasoning. Science, 378(6624), 1067–1074.', url: 'https://doi.org/10.1126/science.ade9097' },
  { key: 'clocktower-bench', cite: 'Patel, 2026', full: 'Patel, D. (2026). Clocktower Bench. Dwarkesh Podcast.', url: 'https://www.dwarkesh.com/p/clocktower' },

  // Statistics
  { key: 'holm', cite: 'Holm, 1979', full: 'Holm, S. (1979). A Simple Sequentially Rejective Multiple Test Procedure. Scandinavian Journal of Statistics, 6(2), 65–70.', url: 'https://www.jstor.org/stable/4615733' },
  { key: 'clopper-pearson', cite: 'Clopper & Pearson, 1934', full: 'Clopper, C. J., & Pearson, E. S. (1934). The use of confidence or fiducial limits illustrated in the case of the binomial. Biometrika, 26(4), 404–413.', url: 'https://doi.org/10.2307/2331986' },
  { key: 'error-bars', cite: 'Miller, 2024', full: 'Miller, E. (2024). Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations. arXiv:2411.00640.', url: 'https://arxiv.org/abs/2411.00640' },
]
