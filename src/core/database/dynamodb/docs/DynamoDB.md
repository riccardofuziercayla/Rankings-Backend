## DynamoDB Design

| PK           | SK_GSI                           | LSI                                | GSI_SK  | ...Attributes                                           |
| ------------ | -------------------------------- | ---------------------------------- | ------- | ------------------------------------------------------- |
| Athlete:{id} | AthleteDetails                   |                                    | {name}  | surname, birth, gender, country, continent, ageCategory |
| Athlete:{id} | Contest:{year}:{discipline}:{id} | Contest:{year}:{discipline}:{date} | {point} |                                                         |
| Athlete:{id} | Rankings:{year}:{discipline}     |                                    | {point} | gender, country, continent, ageCategory                 |
| Contests     | Contest:{year}:{id}              | Contest:{year}:{date}              |         | name, city, country, totalPrize, disciplines[]          |
| Contests     | Contest:{year}:{discipline}:{id} | Contest:{year}:{discipline}:{date} |         | name, city, country, prize, size                        |