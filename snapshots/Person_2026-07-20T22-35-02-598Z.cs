using System;
public class Person
{


    public string Name { get; set; }

    public int Age { get; set; }

    public Person()
    {
        Name = "Unknown";
        Age = 0;
    }
    

    public Person(string name, int age)
    {
        Name = name;
        Age = age;


    }
     

}


