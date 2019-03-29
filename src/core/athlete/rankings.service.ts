import { Injectable } from '@nestjs/common';

import { DatabaseService } from 'core/database/database.service';
import { DDBAthleteRankingsItemPrimaryKey } from 'core/database/dynamodb/athlete/rankings/athlete.rankings.interface';
import { Constants } from 'shared/constants';
import { AgeCategory, Discipline, DisciplineType, Gender, RankingType, Year } from 'shared/enums';
import {
  AgeCategoryUtility,
  ContestTypeUtility,
  DisciplineUtility,
  GenderUtility,
  YearUtility,
} from 'shared/enums/enums-utility';
import { Utils } from 'shared/utils';
import { AthleteService } from './athlete.service';
import { AthleteDetail } from './entity/athlete-detail';
import { AthleteRanking } from './entity/athlete-ranking';
import { AthleteRankingsCategory, RankingsCategory, RankingsUpdateReason } from './interfaces/rankings.interface';

interface RankingCombination {
  year: number;
  discipline: Discipline;
  gender: Gender;
  ageCategory: AgeCategory;
}
@Injectable()
export class RankingsService {
  constructor(private readonly db: DatabaseService, private readonly athleteService: AthleteService) {}

  public async getOverallRank(athleteId: string) {
    const category: AthleteRankingsCategory = {
      rankingType: RankingType.TopScore,
      ageCategory: AgeCategory.All,
      athleteId: athleteId,
      discipline: Discipline.Overall,
      gender: Gender.All,
      year: Year.All,
    };
    return this.getAthleteRankInCategory(category);
  }

  public async getAthleteRankInCategory(category: AthleteRankingsCategory) {
    return this.db.getAthleteRankingPlace(category);
  }

  public async queryRankings(
    limit: number,
    category: RankingsCategory,
    opts: {
      athleteId?: string;
      country?: string;
      after?: {
        athleteId: string;
        points: number;
      };
    } = {},
  ) {
    if (opts.athleteId) {
      limit = 1;
    }

    const rankings = await this.db.queryAthleteRankings(limit, category, {
      after: opts.after,
      filter: {
        id: opts.athleteId,
        country: opts.country,
      },
    });
    return rankings;
  }

  public async updateRankings(
    athleteId: string,
    discipline: Discipline,
    year: number,
    pointsToAdd: number,
    reason: RankingsUpdateReason,
  ) {
    const athlete = await this.db.getAthleteDetails(athleteId);
    if (!athlete) {
      return;
    }
    const p1 = this.updatePointScoreRankings(athlete, discipline, year, pointsToAdd, reason);
    const p2 = this.updateTopScoreRankings(athlete, discipline, year);
    await Promise.all([p1, p2]);
  }

  //#region Point Score
  private async updatePointScoreRankings(
    athlete: AthleteDetail,
    discipline: Discipline,
    year: number,
    pointsToAdd: number,
    reason?: RankingsUpdateReason,
  ) {
    const rankingType = RankingType.PointScore;
    const combinations = this.generateAllCombinationsWithParentCategories(
      year,
      discipline,
      athlete.gender,
      athlete.ageCategory,
    );
    const promises = [];
    for (const combination of combinations) {
      const pk = {
        rankingType: rankingType,
        ageCategory: combination.ageCategory,
        athleteId: athlete.id,
        discipline: combination.discipline,
        gender: combination.gender,
        year: combination.year,
      };
      promises.push(this.updatePointScoreAthleteRanking(pk, athlete, combination, pointsToAdd, reason));
    }
    await Promise.all(promises);
  }

  private async updatePointScoreAthleteRanking(
    pk: DDBAthleteRankingsItemPrimaryKey,
    athlete: AthleteDetail,
    combination: RankingCombination,
    pointsToAdd: number,
    reason?: RankingsUpdateReason,
  ) {
    const rankingType = RankingType.PointScore;

    const athleteRanking = await this.db.getAthleteRanking(pk);
    let numberToAddToContestCount: number;
    switch (reason) {
      case RankingsUpdateReason.NewContest:
        numberToAddToContestCount = 1;
        break;
      case RankingsUpdateReason.PointsChanged:
        numberToAddToContestCount = 0;
        break;
      case RankingsUpdateReason.DeletedContest:
        numberToAddToContestCount = -1;
        break;
    }

    if (athleteRanking) {
      const updatedPoints = athleteRanking.points + pointsToAdd;
      let updatedContestCount: number;
      if (!Utils.isSomeNil(numberToAddToContestCount, athleteRanking.contestCount)) {
        updatedContestCount = athleteRanking.contestCount + numberToAddToContestCount;
      }
      await this.db.updatePointsAndCountOfAthleteRanking(pk, updatedPoints, updatedContestCount);
    } else {
      const item = new AthleteRanking({
        rankingType: rankingType,
        ageCategory: combination.ageCategory,
        country: athlete.country,
        discipline: combination.discipline,
        gender: combination.gender,
        id: athlete.id,
        name: athlete.name,
        birthdate: athlete.birthdate,
        points: pointsToAdd,
        surname: athlete.surname,
        year: combination.year,
        contestCount: numberToAddToContestCount,
      });
      await this.db.putAthleteRanking(item);
    }
  }
  //#endregion

  //#region TopScore
  private async updateTopScoreRankings(athlete: AthleteDetail, discipline: Discipline, year: number) {
    const rankingType = RankingType.TopScore;

    const pointsDict = {};

    const combinations = this.generateAllCombinationsWithParentCategories(
      year,
      discipline,
      athlete.gender,
      athlete.ageCategory,
    );
    const promises = [];
    for (const combination of combinations) {
      const pk = {
        rankingType: rankingType,
        ageCategory: combination.ageCategory,
        athleteId: athlete.id,
        discipline: combination.discipline,
        gender: combination.gender,
        year: combination.year,
      };
      let points = pointsDict[`${combination.discipline}-${combination.year}`];
      if (Utils.isNil(points)) {
        points = await this.calculateNewPointsForTopScore(
          athlete.id,
          combination.discipline,
          combination.year || undefined,
        );
        pointsDict[`${combination.discipline}-${combination.year}`] = points;
      }
      if (points) {
        promises.push(this.updateTopScoreAthleteRanking(pk, athlete, combination, points));
      }
    }
    await Promise.all(promises);
  }

  private async updateTopScoreAthleteRanking(
    pk: DDBAthleteRankingsItemPrimaryKey,
    athlete: AthleteDetail,
    combination: RankingCombination,
    points: number,
  ) {
    const rankingType = RankingType.TopScore;

    const item = new AthleteRanking({
      rankingType: rankingType,
      ageCategory: combination.ageCategory,
      country: athlete.country,
      discipline: combination.discipline,
      gender: combination.gender,
      id: athlete.id,
      name: athlete.name,
      birthdate: athlete.birthdate,
      points: points,
      surname: athlete.surname,
      year: combination.year,
    });
    await this.db.putAthleteRanking(item);
  }

  private async calculateNewPointsForTopScore(athleteId: string, discipline: Discipline, year?: number) {
    let betweenDates;
    if (year && DisciplineUtility.getType(discipline) === DisciplineType.Competition) {
      betweenDates = { start: new Date(year, 0), end: new Date(year + 1, 0) };
    } else {
      betweenDates = {
        start: Utils.DateNow()
          .add(-Constants.TopScoreYearRange, 'years')
          .toDate(),
      };
    }

    const athleteContests = await this.athleteService.getContests(athleteId, discipline, undefined, betweenDates);
    const contests = await Promise.all(
      athleteContests.items.map(async athleteContest => {
        const c = await this.db.getContest(athleteContest.contestId, athleteContest.contestDiscipline);
        return c;
      }),
    );
    const contestsBySizes = contests.sort((a, b) => {
      if (a.contestType === b.contestType) {
        return a.date < b.date ? 1 : -1;
      } else {
        return (
          ContestTypeUtility.ContestTypesBySize.indexOf(a.contestType) -
          ContestTypeUtility.ContestTypesBySize.indexOf(b.contestType)
        );
      }
    });
    const contestsToConsider = contestsBySizes.slice(0, Constants.TopScoreContestSampleCount);
    if (contestsToConsider.length === 0) {
      return null;
    }
    const totalPoints = athleteContests.items
      .filter(i => contestsToConsider.find(c => c.id === i.contestId))
      .sort((a, b) => b.points - a.points)
      .slice(0, Constants.TopScoreContestCount)
      .map(c => c.points)
      .reduce((acc, b) => acc + b);
    return totalPoints;
  }

  //#endregion

  private generateAllCombinationsWithParentCategories(
    year: number,
    discipline: Discipline,
    gender: Gender,
    ageCategory: AgeCategory,
  ) {
    const allYears = [year, ...YearUtility.getParents(year)];
    const allDisciplines = [discipline, ...DisciplineUtility.getParents(discipline)];
    const allGenders = [gender, ...GenderUtility.getParents(gender)];
    const allAgeCategories = [ageCategory, ...AgeCategoryUtility.getParents(ageCategory)];

    const combinations: RankingCombination[] = [];
    for (const y of allYears) {
      for (const d of allDisciplines) {
        for (const g of allGenders) {
          for (const a of allAgeCategories) {
            if (!Utils.isNil(y) && !Utils.isNil(d) && !Utils.isNil(g) && !Utils.isNil(a)) {
              combinations.push({ year: y, discipline: d, gender: g, ageCategory: a });
            }
          }
        }
      }
    }
    return combinations;
  }
}
