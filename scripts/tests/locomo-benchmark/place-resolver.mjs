/**
 * Hierarchical Place Resolution Tree via TypeSafe Jev System-1 API.
 * Disambiguates places into:
 *   1. Real vs Fictional
 *   2. Fictional -> Setting Type (video_game, fantasy_or_sci_fi, anime, other)
 *   3. Real -> Macro Region (North America, Europe, East Asia, Other)
 *   4. Country -> Division (State, Province, Prefecture)
 */

/**
 * Resolves a place name hierarchically using TypeSafe Jev.
 * @param {import('./jev-client.mjs').TypeSafeJevClient} jev
 * @param {string} place
 * @returns {Promise<{ place: string, isReal: boolean, domain: string, region?: string, country?: string, subdivision?: string, settingType?: string }>}
 */
export async function resolvePlaceHierarchically(jev, place) {
  if (!place || typeof place !== 'string' || place.trim().length === 0) {
    return { place, isReal: false, domain: 'unknown' }
  }

  const cleanPlace = place.trim()

  // Step 1: Real vs Fictional check
  const step1 = await jev.systemOne(`Entity to analyze: ${cleanPlace}`, {
    is_real_world: {
      type: 'noul',
      instructions: `Is "${cleanPlace}" a real-world geographic place or city on Earth (as opposed to fictional, mythical, video game, anime, or fantasy)?`,
    },
    domain: {
      type: 'choice',
      instructions: `What domain does "${cleanPlace}" belong to?`,
      criteria: {
        real_world: 'An actual real-world geographical city, town, or location on Earth',
        fictional_or_fantasy: 'A fictional, imaginary, video game, anime, book, or movie location',
        mythical_or_legend: 'An ancient myth or folklore legend (e.g. Atlantis)',
      },
    },
  })

  const isReal = step1.answers.domain?.choice === 'real_world'
  const domain = step1.answers.domain?.choice || 'unknown'

  if (!isReal) {
    // Step 2 Fictional: Disambiguate setting type
    const step2Fictional = await jev.systemOne(`Fictional location: ${cleanPlace}`, {
      setting_type: {
        type: 'choice',
        instructions: `What kind of fictional setting is "${cleanPlace}"?`,
        criteria: {
          video_game: 'A fictional place in a video game (e.g., Genshin Impact, Cyberpunk, Zelda, Final Fantasy)',
          fantasy_or_sci_fi_fiction: 'A fictional place in books, fantasy novels, or movies (e.g., Harry Potter, Lord of the Rings, Narnia)',
          anime_or_manga: 'A fictional setting in anime or manga',
          other_fictional: 'Another fictional, tabletop, or imaginary setting',
        },
      },
    })

    return {
      place: cleanPlace,
      isReal: false,
      domain,
      settingType: step2Fictional.answers.setting_type?.choice || 'other_fictional',
    }
  }

  // Step 2 Real: Global Macro Region
  const step2Region = await jev.systemOne(`Geographic place: ${cleanPlace}`, {
    macro_region: {
      type: 'choice',
      instructions: `Which continent or global region is the real-world place "${cleanPlace}" located in?`,
      criteria: {
        north_america: 'North America (United States, Canada, Mexico)',
        europe: 'Europe (UK, France, Germany, Italy, Spain, etc.)',
        east_asia: 'East Asia (Japan, China, Korea, Taiwan)',
        other_world: 'South America, Africa, Australia/Oceania, South/Southeast Asia, or Middle East',
      },
    },
  })

  const region = step2Region.answers.macro_region?.choice || 'other_world'
  let country = 'unknown'
  let subdivision = 'unknown'

  if (region === 'north_america') {
    const step3Country = await jev.systemOne(`North American place: ${cleanPlace}`, {
      country: {
        type: 'choice',
        instructions: `Which country in North America is "${cleanPlace}" in?`,
        criteria: {
          usa: 'United States of America',
          canada: 'Canada',
          mexico: 'Mexico',
        },
      },
    })
    country = step3Country.answers.country?.choice || 'usa'

    if (country === 'usa') {
      const step4USRegion = await jev.systemOne(`US city: ${cleanPlace}`, {
        us_region: {
          type: 'choice',
          instructions: `Which US geographical region is the city "${cleanPlace}" in?`,
          criteria: {
            new_england: 'New England (Connecticut, Massachusetts, Maine, New Hampshire, Rhode Island, Vermont)',
            mid_atlantic: 'Mid-Atlantic (New York, New Jersey, Pennsylvania)',
            pacific_northwest: 'Pacific Northwest / West Coast (Washington, Oregon, California)',
            south_or_midwest: 'South, Midwest, or Mountain states',
          },
        },
      })
      const usReg = step4USRegion.answers.us_region?.choice

      if (usReg === 'new_england') {
        const step5State = await jev.systemOne(`New England place: ${cleanPlace}`, {
          state: {
            type: 'choice',
            instructions: `Which New England state is "${cleanPlace}" in?`,
            criteria: {
              connecticut: 'Connecticut (CT)',
              massachusetts: 'Massachusetts (MA)',
              rhode_island: 'Rhode Island (RI)',
              maine: 'Maine (ME)',
              new_hampshire: 'New Hampshire (NH)',
              vermont: 'Vermont (VT)',
            },
          },
        })
        subdivision = step5State.answers.state?.choice || 'connecticut'
      }
      else if (usReg === 'pacific_northwest') {
        const step5State = await jev.systemOne(`Pacific US place: ${cleanPlace}`, {
          state: {
            type: 'choice',
            instructions: `Which Pacific / West Coast state is "${cleanPlace}" in?`,
            criteria: {
              washington: 'Washington (WA)',
              oregon: 'Oregon (OR)',
              california: 'California (CA)',
            },
          },
        })
        subdivision = step5State.answers.state?.choice || 'washington'
      }
      else if (usReg === 'mid_atlantic') {
        const step5State = await jev.systemOne(`Mid-Atlantic US place: ${cleanPlace}`, {
          state: {
            type: 'choice',
            instructions: `Which Mid-Atlantic state is "${cleanPlace}" in?`,
            criteria: {
              new_york: 'New York (NY)',
              new_jersey: 'New Jersey (NJ)',
              pennsylvania: 'Pennsylvania (PA)',
            },
          },
        })
        subdivision = step5State.answers.state?.choice || 'new_york'
      }
    }
    else if (country === 'canada') {
      const step4Province = await jev.systemOne(`Canadian city: ${cleanPlace}`, {
        province: {
          type: 'choice',
          instructions: `Which Canadian province or territory is "${cleanPlace}" in?`,
          criteria: {
            british_columbia: 'British Columbia (BC)',
            ontario: 'Ontario (ON)',
            quebec: 'Quebec (QC)',
            alberta: 'Alberta (AB)',
            other_province: 'Other Canadian province/territory',
          },
        },
      })
      subdivision = step4Province.answers.province?.choice || 'british_columbia'
    }
  }
  else if (region === 'east_asia') {
    const step3Asia = await jev.systemOne(`East Asian city: ${cleanPlace}`, {
      country: {
        type: 'choice',
        instructions: `Which country is "${cleanPlace}" in?`,
        criteria: {
          japan: 'Japan',
          china: 'China',
          south_korea: 'South Korea',
          taiwan: 'Taiwan',
        },
      },
    })
    country = step3Asia.answers.country?.choice || 'japan'
  }

  return {
    place: cleanPlace,
    isReal: true,
    domain,
    region,
    country,
    subdivision,
  }
}
